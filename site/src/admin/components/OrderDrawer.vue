<script setup lang="ts">
/** 批次详情：一句话概况、进度、客户收款地址、单价、打款记录、链接、批次操作 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Plus } from '@element-plus/icons-vue'
import PaylinkUrl from '@site/shared/PaylinkUrl.vue'
import { api, guard } from '@site/shared/api'
import { LINK_STATUS, ORDER_STATUS, cny, copyText, dt, networkName, num, usd, walletFresh } from '@site/shared/format'
import { drawerSize, useViewport } from '@site/shared/responsive'
import type { AdminOrder } from '../state'
import SettlementTable, { type Settlement } from './SettlementTable.vue'
import SettleModal from './SettleModal.vue'

const props = defineProps<{ orderId: number }>()
const emit = defineEmits<{ close: []; changed: []; 'goto-links': [params: Record<string, unknown>] }>()

const { width: vw } = useViewport()
const size = computed(() => drawerSize(vw.value, 860))

interface Link {
  id: number
  url: string
  status: string
  amount_due: string | null
  amount_cny: string | null
  claimed_at: string | null
  paid_at: string | null
}

const loading = ref(true)
const order = ref<AdminOrder | null>(null)
const links = ref<Link[]>([])
const settlements = ref<Settlement[]>([])
const filter = ref('all')
const paying = ref(false)
const savingPrice = ref(false)
// 已结金额只由打款记录累加，不再手改；这里只留单价可以改
const price = ref<number | null>(null)
const qty = ref<number | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [o, l, s] = await Promise.all([
      api.admin<{ orders: AdminOrder[] }>('orders', { id: props.orderId, page: 1, page_size: 5 }),
      api.admin<{ links: Link[] }>('links', { order_id: props.orderId, include_void: 1, page_size: 500 }),
      api.admin<{ settlements: Settlement[] }>('settlements', { order_id: props.orderId, page_size: 100 })
    ])
    const row = o.orders[0]
    if (!row) throw new Error('批次不存在')
    order.value = row
    const rank: Record<string, number> = { claimed: 0, checking: 1, paid: 2, refresh: 3, superseded: 4 }
    links.value = l.links.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.id - b.id)
    settlements.value = s.settlements
    price.value = row.unit_price === null ? null : num(row.unit_price)
  } finally {
    loading.value = false
  }
}
onMounted(() => void guard(load))

async function reload(): Promise<void> {
  await guard(load)
  emit('changed')
}

const count = (s: string): number => links.value.filter((l) => l.status === s).length
const shown = computed(() => (filter.value === 'all' ? links.value : links.value.filter((l) => l.status === filter.value)))
const unpaid = computed(() => links.value.filter((l) => l.status === 'claimed' || l.status === 'checking'))
const due = computed(() => num(order.value?.due_amount))
const walletOk = computed(() => order.value?.wallet_address && order.value.wallet_network === 'polygon')

/** 只改单价。服务端 order_settle 只收到 unit_price 时会按新单价重算结算状态 */
async function savePrice(): Promise<void> {
  savingPrice.value = true
  try {
    await guard(async () => {
      await api.admin('order_settle', { id: props.orderId, unit_price: price.value ?? '' })
      ElMessage.success('单价已修改')
      await reload()
    })
  } finally {
    savingPrice.value = false
  }
}

/** 一句话说清楚这批的钱和进度 */
const summary = computed(() => {
  const o = order.value
  if (!o) return ''
  const paid = num(o.paid)
  const parts = [`已付客户 ${usd(o.settled_amount)}`]
  parts.push(
    o.unit_price !== null
      ? `完成 ${paid} / ${o.quantity}（价值 ${usd(o.due_amount)} / ${usd(o.quantity * num(o.unit_price))}）`
      : `完成 ${paid} / ${o.quantity}（按实付 ${usd(o.due_amount)}）`
  )
  if (o.status === 'open' && o.quantity > paid) parts.push(`还差 ${o.quantity - paid} 个`)
  return parts.join(' · ')
})

async function confirmThen(title: string, message: string, fn: () => Promise<void>, danger = true): Promise<void> {
  try {
    await ElMessageBox.confirm(message, title, { type: danger ? 'warning' : 'info', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return
  }
  await guard(fn)
}

const resolve = (link: Link, result: 'paid' | 'expired'): Promise<void> =>
  confirmThen(
    result === 'paid' ? '确认已付' : '确认失效',
    result === 'paid' ? '记成已付款，计入客户结算。请先确认这个号真的付了。' : '记成失效，进入待换新，桌面端会换一条新链接。',
    async () => {
      await api.admin('link_resolve', { id: link.id, result })
      ElMessage.success('已定性')
      await reload()
    },
    result !== 'paid'
  )

const revokeHolding = (): Promise<void> =>
  confirmThen(`收回 ${unpaid.value.length} 条没付的链接`, '收回后这些链接作废，客户那边会消失，名额放回批次（可以重新领）。已付款的不受影响。', async () => {
    const r = await api.admin<{ revoked: number }>('link_revoke', { ids: unpaid.value.map((l) => l.id) })
    ElMessage.success(`已收回 ${r.revoked} 条`)
    await reload()
  })

const finish = (): Promise<void> =>
  confirmThen(
    `标记批次 ${order.value!.code} 为完成`,
    num(order.value!.holding) ? `之后不能再领；客户手里还没付的 ${num(order.value!.holding)} 条照样能付。` : '之后不能再领。',
    async () => {
      await api.admin('order_update', { id: props.orderId, status: 'done' })
      ElMessage.success('已标记完成')
      await reload()
    },
    false
  )

const cancel = (): Promise<void> =>
  confirmThen(`取消批次 ${order.value!.code}`, '客户手里没付的链接会收回并换新，已付款的照常结算。', async () => {
    await api.admin('order_update', { id: props.orderId, status: 'cancelled' })
    ElMessage.success('已取消')
    await reload()
  })

async function changeQty(): Promise<void> {
  const min = Math.max(1, num(order.value?.paid) + num(order.value?.holding))
  if (!qty.value || qty.value < min) return void ElMessage.error(`目标付款数不能少于已付 + 待付（${min}）`)
  await guard(async () => {
    await api.admin('order_update', { id: props.orderId, quantity: qty.value })
    ElMessage.success('已修改')
    qty.value = null
    await reload()
  })
}

async function copyUnpaid(): Promise<void> {
  const urls = links.value.filter((l) => l.status === 'claimed').map((l) => l.url)
  await copyText(urls.join('\n'))
  ElMessage.success(`已复制 ${urls.length} 条`)
}
</script>

<template>
  <el-drawer :model-value="true" :size="size" @close="emit('close')">
    <template #header>
      <div class="drawer-title">
        <b>{{ order?.code }}</b>
        <el-tag v-if="order" size="small" :type="ORDER_STATUS[order.status]?.type || undefined">
          {{ ORDER_STATUS[order.status]?.text }}
        </el-tag>
        <el-tag v-if="order?.source === 'offline'" size="small">线下发出</el-tag>
        <span class="muted small">{{ order?.client }}</span>
      </div>
    </template>

    <div v-loading="loading" class="body">
      <template v-if="order">
        <!-- 一句话说清楚：付了多少、做完多少、还差几个 -->
        <div class="summary">{{ summary }}</div>
        <div class="stats">
          <el-card shadow="never">
            <div class="stat-label">已付</div>
            <div class="stat-value ok">{{ num(order.paid) }} / {{ order.quantity }}</div>
            <el-progress
              :percentage="Math.min(100, Math.round((num(order.paid) / Math.max(1, order.quantity)) * 100))"
              :show-text="false"
            />
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">待付</div>
            <div class="stat-value warn">{{ num(order.holding) }}</div>
            <div class="stat-sub">{{ num(order.void) ? `作废 ${num(order.void)}` : '' }}</div>
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">付客户</div>
            <div class="stat-value">{{ usd(due) }}</div>
            <div class="stat-sub">
              {{ order.unit_price !== null ? `${num(order.paid)} 条 × ${usd(order.unit_price)}` : '按客户实付合计' }}
            </div>
          </el-card>
          <el-card shadow="never">
            <div class="stat-label">客户实付 Stripe</div>
            <div class="stat-value muted">{{ usd(order.paid_usd) }}</div>
            <div class="stat-sub">
              <span v-if="num(order.paid_cny)" class="nowrap">≈ {{ cny(order.paid_cny) }}</span>
              <template v-if="order.unit_price !== null">
                <span v-if="num(order.paid_cny)">·</span>
                <span class="nowrap">
                  客户赚 <b :class="num(order.client_profit) >= 0 ? 'ok' : 'danger'">{{ usd(order.client_profit) }}</b>
                </span>
              </template>
            </div>
          </el-card>
        </div>

        <div class="two">
          <el-card shadow="never">
            <template #header><h2 class="head">客户收款地址</h2></template>
            <el-alert
              v-if="order.wallet_address && order.wallet_network !== 'polygon'"
              type="error"
              show-icon
              :closable="false"
              :title="`客户填的是 ${networkName(order.wallet_network)} 地址，现在只支持 Polygon`"
              description="请让客户在门户「收款设置」里重填 Polygon 地址，别往这个地址打款。"
            />
            <el-alert
              v-else-if="!order.wallet_address"
              type="warning"
              show-icon
              :closable="false"
              title="客户还没设置收款地址"
              description="让客户在门户「收款设置」里填，或在客户列表里代填。"
            />
            <el-descriptions v-if="walletOk" :column="1" border size="small">
              <el-descriptions-item label="网络 / 币种">
                {{ networkName(order.wallet_network) }} · {{ order.wallet_token }}
              </el-descriptions-item>
              <el-descriptions-item label="地址">
                <span class="mono">{{ order.wallet_address }}</span>
                <el-button text size="small" :icon="CopyDocument" @click="copyText(order.wallet_address!)" />
              </el-descriptions-item>
              <el-descriptions-item label="最近修改">
                {{ order.wallet_updated_at ?? '-' }}
                <el-tag v-if="walletFresh(order.wallet_updated_at)" size="small" type="danger">
                  24 小时内改过，打款前先跟客户确认
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <!-- 原来这里能手改「结算状态」和「已结金额」，和打款记录是两条口子，账容易对不上。
               现在已结金额只由下面的打款记录累加，这里只留单价可改 -->
          <el-card shadow="never">
            <template #header><h2 class="head">每个多少钱</h2></template>
            <el-input-number v-model="price" :min="0" :max="1000" :precision="2" placeholder="不填 = 按客户实付" class="full" />
            <div class="muted small price-hint">
              {{ price == null ? '不填 = 按客户在 Stripe 实际付的钱结' : `应付客户 = 完成数 × ${usd(price)}` }}
            </div>
            <el-button :loading="savingPrice" @click="savePrice">保存单价</el-button>
          </el-card>
        </div>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <h2>打款记录<span class="muted small"> {{ settlements.length }}</span></h2>
              <el-button type="primary" size="small" :icon="Plus" @click="paying = true">记一笔打款</el-button>
            </div>
          </template>
          <SettlementTable :rows="settlements" :with-order="false" :with-client="false" @changed="reload" />
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <h2>链接<span class="muted small"> {{ links.length }}</span></h2>
              <el-button size="small" :disabled="!count('claimed')" @click="copyUnpaid">
                复制待付的 {{ count('claimed') }} 条
              </el-button>
            </div>
          </template>
          <el-radio-group v-model="filter" size="small" class="seg">
            <el-radio-button value="all">全部 {{ links.length }}</el-radio-button>
            <el-radio-button value="claimed">待付 {{ count('claimed') }}</el-radio-button>
            <el-radio-button value="checking">确认中 {{ count('checking') }}</el-radio-button>
            <el-radio-button value="paid">已付 {{ count('paid') }}</el-radio-button>
            <el-radio-button value="superseded">作废 {{ count('superseded') }}</el-radio-button>
          </el-radio-group>
          <el-table :data="shown" size="small" max-height="420">
            <el-table-column type="index" width="44" />
            <el-table-column label="状态" width="96">
              <template #default="{ row }">
                <el-tag size="small" :type="LINK_STATUS[row.status]?.type || undefined">
                  {{ LINK_STATUS[row.status]?.text ?? row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="金额" width="92" align="right">
              <template #default="{ row }"><span class="num small">{{ usd(row.amount_due) }}</span></template>
            </el-table-column>
            <el-table-column label="链接" min-width="190">
              <template #default="{ row }">
                <PaylinkUrl :url="row.url" :void="row.status === 'superseded'" tip="点击复制整条链接" />
              </template>
            </el-table-column>
            <el-table-column label="时间" width="104">
              <template #default="{ row }"><span class="small muted">{{ dt(row.paid_at || row.claimed_at) }}</span></template>
            </el-table-column>
            <el-table-column width="150" align="right">
              <template #default="{ row }">
                <template v-if="row.status === 'checking'">
                  <el-button size="small" @click="resolve(row, 'paid')">确认已付</el-button>
                  <el-button size="small" type="danger" plain @click="resolve(row, 'expired')">失效</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card v-if="order.status === 'open'" shadow="never">
          <template #header><h2 class="head">批次操作</h2></template>
          <div class="actions">
            <el-button @click="finish">标记完成</el-button>
            <el-tooltip content="把客户手里还没付的收回：名额立刻放出来，旧链接作废换新" placement="top">
              <el-button :disabled="!unpaid.length" @click="revokeHolding">收回未付（{{ unpaid.length }}）</el-button>
            </el-tooltip>
            <el-input-number v-model="qty" :min="1" :max="1000" :placeholder="`目标 ${order.quantity}`" class="qty" />
            <el-button :disabled="!qty" @click="changeQty">改目标付款数</el-button>
            <el-button type="danger" plain @click="cancel">取消批次</el-button>
          </div>
        </el-card>
      </template>
    </div>

    <SettleModal v-if="paying && order" :order="order" @close="paying = false" @saved="reload" />
  </el-drawer>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 14px; }
.drawer-title { display: flex; align-items: center; gap: 8px; }
.head { margin: 0; font-size: 15px; font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.full { width: 100%; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.seg { margin-bottom: 10px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qty { width: 130px; }
/* 顶部那句「已付客户 $200 · 完成 16/20 · 还差 4 个」 */
.summary {
  padding: 10px 14px;
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  line-height: 1.6;
}
.price-hint { margin: 6px 0 10px; }
@media (max-width: 900px) {
  .two, .two-col { grid-template-columns: 1fr; }
}
</style>
