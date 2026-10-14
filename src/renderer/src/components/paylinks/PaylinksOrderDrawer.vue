<script setup lang="ts">
/**
 * 批次详情（抽屉）：进度、客户收款地址、结算状态（可手动改）、打款记录（记一笔 / 删除 / 看凭证）、
 * 批次里的全部链接（含作废，可筛选、复制待付、确认中可手动定性），以及完成 / 改数量 / 取消。
 */
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CopyOutlined, PlusOutlined } from '@ant-design/icons-vue'
import PaylinkUrl from '@/components/paylinks/PaylinkUrl.vue'
import PaylinksSettleModal from '@/components/paylinks/PaylinksSettleModal.vue'
import PaylinksSettlementTable from '@/components/paylinks/PaylinksSettlementTable.vue'
import { confirmDanger, copyText } from '@/utils/ui'
import {
  LINK_STATUS_META,
  ORDER_STATUS_META,
  SETTLE_STATUS_META,
  networkName,
  paylinksAdmin,
  walletFresh,
  type AdminClient,
  type AdminLink,
  type AdminOrder,
  type AdminSettlement,
  type SettleStatus
} from '@/utils/paylinksAdmin'

const props = defineProps<{ orderId: number; clients: AdminClient[] }>()
const emit = defineEmits<{ changed: []; close: [] }>()

const order = ref<AdminOrder | null>(null)
const links = ref<AdminLink[]>([])
const settlements = ref<AdminSettlement[]>([])
const loading = ref(false)
const filter = ref<string>('all')
const settling = ref(false)
const form = ref<{ settle_status: SettleStatus; settled_amount: number; settle_note: string; unit_price: number | null }>({ settle_status: 'unsettled', settled_amount: 0, settle_note: '', unit_price: null })
const savingSettle = ref(false)

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const usd = (v: string | number | null | undefined): string => `$${n(v).toFixed(2)}`
const short = (v: string | null | undefined): string => (v ? v.slice(5, 16) : '-')

async function load(): Promise<void> {
  loading.value = true
  try {
    const [o, l, s] = await Promise.all([
      paylinksAdmin.ordersPage({ id: props.orderId, page: 1, page_size: 5 }).then((r) => r.orders[0]),
      paylinksAdmin.links({ order_id: props.orderId, include_void: 1, page_size: 500 }),
      paylinksAdmin.settlements({ order_id: props.orderId, page_size: 100 })
    ])
    if (!o) throw new Error('批次不存在')
    order.value = o
    const rank: Record<string, number> = { claimed: 0, checking: 1, paid: 2, refresh: 3, superseded: 4 }
    links.value = l.links.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.id - b.id)
    settlements.value = s.settlements
    form.value = { settle_status: o.settle_status, settled_amount: n(o.settled_amount), settle_note: o.settle_note || '', unit_price: o.unit_price != null ? Number(o.unit_price) : null }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    loading.value = false
  }
}
watch(() => props.orderId, load, { immediate: true })

async function reload(): Promise<void> {
  await load()
  emit('changed')
}

const count = (s: string): number => links.value.filter((l) => l.status === s).length
const shown = computed(() => (filter.value === 'all' ? links.value : links.value.filter((l) => l.status === filter.value)))
const unpaid = computed(() => links.value.filter((l) => l.status === 'claimed'))
const left = computed(() => Math.max(0, n(order.value?.due_amount) - n(order.value?.settled_amount)))
const pct = computed(() => Math.min(100, Math.round((n(order.value?.paid) / Math.max(1, n(order.value?.quantity))) * 100)))

async function saveSettle(): Promise<void> {
  if (!order.value) return
  savingSettle.value = true
  try {
    await paylinksAdmin.settleOrder({ id: order.value.id, ...form.value, unit_price: form.value.unit_price ?? '' })
    message.success('结算状态已保存')
    await reload()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    savingSettle.value = false
  }
}

function resolve(link: AdminLink, result: 'paid' | 'expired'): void {
  confirmDanger({
    title: result === 'paid' ? '确认已付' : '确认失效',
    content: result === 'paid' ? '记成已付款，计入客户结算。请先确认这个号真的付了。' : '记成失效，进入待换新，桌面端会换一条新链接。',
    okText: '确定',
    onOk: async () => {
      await paylinksAdmin.resolveLink(link.id, result)
      message.success('已定性')
      await reload()
    }
  })
}

/** 收回这个批次里客户手里没付的链接：名额放出来，旧链接作废 */
function revokeHolding(): void {
  const o = order.value!
  const ids = links.value.filter((l) => l.status === 'claimed' || l.status === 'checking').map((l) => l.id)
  if (!ids.length) return
  confirmDanger({
    title: `收回 ${ids.length} 条没付的链接`,
    content: '收回后这些链接作废，客户那边会消失，名额放回批次（可以重新领）。已付款的不受影响。',
    okText: '收回',
    onOk: async () => {
      const r = await paylinksAdmin.revokeLinks(ids)
      message.success(`已收回 ${r.revoked} 条`)
      await reload()
    }
  })
}

function finish(): void {
  const o = order.value!
  confirmDanger({
    title: `标记批次 ${o.code} 为完成`,
    content: n(o.holding) ? `之后不能再领；客户手里还没付的 ${n(o.holding)} 条照样能付。` : '之后不能再领。',
    okText: '标记完成',
    okButtonProps: { type: 'primary' },
    onOk: async () => {
      await paylinksAdmin.updateOrder({ id: o.id, status: 'done' })
      message.success('已标记完成')
      await reload()
    }
  })
}

function cancel(): void {
  const o = order.value!
  confirmDanger({
    title: `取消批次 ${o.code}`,
    content: '客户手里没付的链接会收回并换新，已付款的照常结算。',
    okText: '取消批次',
    onOk: async () => {
      await paylinksAdmin.updateOrder({ id: o.id, status: 'cancelled' })
      message.success('已取消')
      await reload()
    }
  })
}

const qty = ref<number | null>(null)
async function changeQty(): Promise<void> {
  const o = order.value!
  const min = Math.max(1, n(o.paid) + n(o.holding))
  if (!qty.value || qty.value < min) return void message.error(`数量不能少于已付 + 待付（${min}）`)
  try {
    await paylinksAdmin.updateOrder({ id: o.id, quantity: qty.value })
    message.success('已修改数量')
    qty.value = null
    await reload()
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}
</script>
<template>
  <a-drawer :open="true" width="min(880px, 92vw)" :title="order ? `批次 ${order.code}` : '批次'" @close="emit('close')">
    <template #extra>
      <a-space v-if="order">
        <a-tag :color="ORDER_STATUS_META[order.status].color" :bordered="false">{{ ORDER_STATUS_META[order.status].text }}</a-tag>
        <a-tag v-if="order.source === 'offline'" :bordered="false">线下发出</a-tag>
        <span class="muted">{{ order.client }}</span>
      </a-space>
    </template>
    <a-spin :spinning="loading">
      <div v-if="order" class="body">
        <div class="stats">
          <a-card size="small"><div class="label">已付</div><div class="value ok">{{ n(order.paid) }} / {{ order.quantity }}</div><a-progress :percent="pct" size="small" :show-info="false" /></a-card>
          <a-card size="small"><div class="label">待付</div><div class="value warn">{{ n(order.holding) }}</div><div class="sub">{{ n(order.void) ? `作废 ${n(order.void)}` : ' ' }}</div></a-card>
          <a-card size="small"><div class="label">应结</div><div class="value">{{ usd(order.due_amount) }}</div>
            <div class="sub">{{ order.unit_price != null ? `已付 ${n(order.paid)} 条 × ${usd(order.unit_price)}` : `按实付合计 · ≈ ¥${n(order.paid_cny).toFixed(2)}` }}</div></a-card>
          <a-card size="small"><div class="label">已结</div><div class="value primary">{{ usd(order.settled_amount) }}</div>
            <div class="sub"><a-tag :color="SETTLE_STATUS_META[order.settle_status].color" :bordered="false">{{ SETTLE_STATUS_META[order.settle_status].text }}</a-tag><template v-if="left > 0.004">还差 {{ usd(left) }}</template></div></a-card>
        </div>

        <div class="two">
          <a-card size="small" title="客户收款地址">
            <a-descriptions v-if="order.wallet_address && order.wallet_network === 'polygon'" :column="1" size="small">
              <a-descriptions-item label="网络 / 币种">{{ networkName(order.wallet_network) }} · {{ order.wallet_token }}</a-descriptions-item>
              <a-descriptions-item label="地址">
                <span class="mono addr">{{ order.wallet_address }}</span>
                <a-button type="link" size="small" @click="copyText(order.wallet_address!, '已复制地址')"><template #icon><CopyOutlined /></template></a-button>
              </a-descriptions-item>
              <a-descriptions-item label="最近修改">
                {{ order.wallet_updated_at || '-' }}
                <a-tag v-if="walletFresh(order.wallet_updated_at)" color="red" :bordered="false">24 小时内改过，先跟客户确认</a-tag>
              </a-descriptions-item>
            </a-descriptions>
            <a-alert v-if="order.wallet_address && order.wallet_network !== 'polygon'" type="error" show-icon class="gap"
              :message="`客户填的是 ${networkName(order.wallet_network)} 地址，现在只支持 Polygon`" description="请让客户在门户「收款设置」里重填 Polygon 地址，别往这个地址打款。" />
            <a-alert v-if="!order.wallet_address" type="warning" show-icon message="客户还没设置收款地址" description="让客户在门户「收款设置」里填，或在客户列表里代填。" />
          </a-card>
          <a-card size="small" title="结算状态">
            <a-form layout="vertical" class="settle-form">
              <a-form-item label="状态">
                <a-select v-model:value="form.settle_status" :options="Object.entries(SETTLE_STATUS_META).map(([value, m]) => ({ value, label: m.text }))" />
              </a-form-item>
              <a-form-item label="已结金额（USD）">
                <a-input-number v-model:value="form.settled_amount" :min="0" :precision="2" style="width: 100%" />
              </a-form-item>
              <a-form-item label="每条结算单价" :extra="form.unit_price == null ? '留空 = 按每条实付金额' : `应结 = 已付条数 × ${usd(form.unit_price)}`">
                <a-input-number v-model:value="form.unit_price" :min="0" :max="1000" :precision="2" placeholder="留空 = 按实付" style="width: 100%" />
              </a-form-item>
              <a-form-item label="结算备注" class="span-2">
                <a-input v-model:value="form.settle_note" :maxlength="255" placeholder="如：按 1:1 结算，扣手续费 1 USDT" />
              </a-form-item>
              <div class="span-2 row">
                <a-button type="primary" :loading="savingSettle" @click="saveSettle">保存结算状态</a-button>
                <span class="muted small">记一笔打款会自动累加；这里可以手动改</span>
              </div>
            </a-form>
          </a-card>
        </div>

        <a-card size="small" :title="`打款记录（${settlements.length}）`">
          <template #extra>
            <a-button type="primary" size="small" @click="settling = true"><template #icon><PlusOutlined /></template>记一笔打款</a-button>
          </template>
          <PaylinksSettlementTable :rows="settlements" :with-order="false" :with-client="false" @changed="reload" />
        </a-card>

        <a-card size="small" :title="`链接（${links.length}）`">
          <template #extra>
            <a-button size="small" :disabled="!unpaid.length" @click="copyText(unpaid.map((l) => l.url).join('\n'), `已复制待付的 ${unpaid.length} 条`)">
              复制待付的 {{ unpaid.length }} 条
            </a-button>
          </template>
          <a-radio-group v-model:value="filter" size="small" button-style="solid" class="gap">
            <a-radio-button value="all">全部 {{ links.length }}</a-radio-button>
            <a-radio-button value="claimed">待付 {{ count('claimed') }}</a-radio-button>
            <a-radio-button value="checking">确认中 {{ count('checking') }}</a-radio-button>
            <a-radio-button value="paid">已付 {{ count('paid') }}</a-radio-button>
            <a-radio-button value="superseded">作废 {{ count('superseded') }}</a-radio-button>
          </a-radio-group>
          <a-table :data-source="shown" :row-key="(r: AdminLink) => r.id" :pagination="{ pageSize: 20, size: 'small', hideOnSinglePage: true }" size="small"
            :columns="[{ title: '#', key: 'n', width: 44 }, { title: '状态', key: 'status', width: 96 }, { title: '金额', key: 'amount', width: 90 }, { title: '链接', key: 'url' }, { title: '时间', key: 'time', width: 100 }, { title: '', key: 'act', width: 150 }]">
            <template #bodyCell="{ column, record, index }">
              <template v-if="column.key === 'n'">{{ index + 1 }}</template>
              <template v-else-if="column.key === 'status'">
                <a-tag :color="LINK_STATUS_META[record.status as AdminLink['status']]?.color" :bordered="false">{{ LINK_STATUS_META[record.status as AdminLink['status']]?.text ?? record.status }}</a-tag>
              </template>
              <template v-else-if="column.key === 'amount'"><span class="small">{{ usd(record.amount_due) }}</span></template>
              <template v-else-if="column.key === 'url'"><PaylinkUrl :url="record.url" :void="record.status === 'superseded'" /></template>
              <template v-else-if="column.key === 'time'"><span class="small">{{ short(record.paid_at || record.claimed_at) }}</span></template>
              <template v-else-if="column.key === 'act'">
                <a-space v-if="record.status === 'checking'" :size="4">
                  <a-button size="small" @click="resolve(record, 'paid')">确认已付</a-button>
                  <a-button size="small" danger @click="resolve(record, 'expired')">失效</a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card v-if="order.status === 'open'" size="small" title="批次操作">
          <a-space wrap>
            <a-button @click="finish">标记完成</a-button>
            <a-tooltip title="把客户手里还没付的链接收回：名额立刻放出来，客户可以重新领；旧链接作废，桌面端会换新上架">
              <a-button :disabled="!n(order.holding)" @click="revokeHolding">收回未付（{{ n(order.holding) }}）</a-button>
            </a-tooltip>
            <a-input-number v-model:value="qty" :min="1" :max="1000" :placeholder="`目标 ${order.quantity}`" style="width: 120px" />
            <a-button :disabled="!qty" @click="changeQty">改目标付款数</a-button>
            <a-button danger @click="cancel">取消批次</a-button>
          </a-space>
        </a-card>
      </div>
    </a-spin>
    <PaylinksSettleModal v-if="settling && order" :clients="clients" :order="order" @saved="reload" @close="settling = false" />
  </a-drawer>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 14px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
@media (max-width: 760px) { .stats { grid-template-columns: 1fr 1fr; } .two { grid-template-columns: 1fr; } }
.label { font-size: 12px; color: var(--kal-muted); }
.value { font-size: 20px; font-weight: 600; line-height: 1.3; }
.sub { font-size: 12px; color: var(--kal-muted); min-height: 22px; }
.ok { color: #52c41a; }
.warn { color: #fa8c16; }
.primary { color: var(--ant-color-primary, #1677ff); }
.settle-form { display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; }
.settle-form :deep(.ant-form-item) { margin-bottom: 10px; }
.span-2 { grid-column: span 2; }
.row { display: flex; align-items: center; gap: 10px; }
.gap { margin-bottom: 10px; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.addr { word-break: break-all; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
</style>
