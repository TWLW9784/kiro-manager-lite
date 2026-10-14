<script setup lang="ts">
/**
 * 网站管理：总览 / 批次（详情里结算与打款）/ 结算 / 客户 / 链接 / 日志，与网页后台功能一致。
 * 客户行可以跳到他的批次或链接；结算页点批次号打开批次详情。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined
} from '@ant-design/icons-vue'
import PaylinksClientModal from '@/components/paylinks/PaylinksClientModal.vue'
import PaylinksLinksPane from '@/components/paylinks/PaylinksLinksPane.vue'
import PaylinksOrdersPane from '@/components/paylinks/PaylinksOrdersPane.vue'
import PaylinksSettlementsPane from '@/components/paylinks/PaylinksSettlementsPane.vue'
import PaylinksLogsPane from '@/components/paylinks/PaylinksLogsPane.vue'
import { useSettingsStore } from '@/stores/settings'
import { confirmDanger, copyText } from '@/utils/ui'
import {
  LINK_STATUS_META,
  adminConfigured,
  networkName,
  walletFresh,
  paylinksAdmin,
  type AdminClient,
  type AdminLink,
  type AdminOverview
} from '@/utils/paylinksAdmin'

const props = defineProps<{ active?: boolean }>()
const emit = defineEmits<{ 'open-sync': [] }>()
const settingsStore = useSettingsStore()

const overview = ref<AdminOverview | null>(null)
const clients = ref<AdminClient[]>([])
const loading = ref(false)
const error = ref('')
const editing = ref<AdminClient | null | undefined>(undefined)
/** 链接明细的客户筛选，点客户行「查看链接」时设置 */
const linkClient = ref<number | undefined>(undefined)
/** 批次页的客户 / 结算筛选，从客户行、结算页跳过来时设置 */
const orderClient = ref<number | undefined>(undefined)
const orderSettle = ref<string | undefined>(undefined)
const tab = ref('overview')
const ordersPane = ref<InstanceType<typeof PaylinksOrdersPane> | null>(null)

const configured = computed(() => adminConfigured())

async function load(): Promise<void> {
  if (!configured.value || loading.value) return
  loading.value = true
  try {
    const [o, c] = await Promise.all([paylinksAdmin.overview(), paylinksAdmin.clients()])
    overview.value = o
    clients.value = c
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(
  () => props.active,
  (on) => on && load()
)

/** 总览卡片：按状态汇总（所有档位加起来） */
const statusTotals = computed(() => {
  const result: Record<string, { n: number; usd: number; cny: number }> = {}
  for (const key of Object.keys(LINK_STATUS_META)) result[key] = { n: 0, usd: 0, cny: 0 }
  for (const row of overview.value?.by_status ?? []) {
    const slot = (result[row.status] ??= { n: 0, usd: 0, cny: 0 })
    slot.n += Number(row.n)
    slot.usd += Number(row.usd ?? 0)
    slot.cny += Number(row.cny ?? 0)
  }
  return result
})

const today = computed(() => (overview.value?.now ?? '').slice(0, 10))
const paidToday = computed(() =>
  (overview.value?.daily ?? []).filter((d) => d.day === today.value).reduce((s, d) => s + Number(d.n), 0)
)

/** 近 14 天：按天汇总，鼠标停上去看每个客户 */
const dailyRows = computed(() => {
  const byDay = new Map<string, { day: string; n: number; parts: string[] }>()
  for (const d of overview.value?.daily ?? []) {
    const slot = byDay.get(d.day) ?? { day: d.day, n: 0, parts: [] }
    slot.n += Number(d.n)
    slot.parts.push(`${d.client || '未归属'} ${d.n}`)
    byDay.set(d.day, slot)
  }
  return [...byDay.values()]
})

const columns = [
  { title: '客户', key: 'name', ellipsis: true },
  { title: '状态', key: 'enabled', width: 76 },
  { title: '收款地址', key: 'wallet', width: 200 },
  { title: '待付', key: 'claimed', width: 64 },
  { title: '已付', key: 'paid', width: 90 },
  { title: '应结 / 未结', key: 'amount', width: 120 },
  { title: '领取规则', key: 'rule', width: 120 },
  { title: '最近登录', key: 'login', width: 100 },
  { title: '', key: 'actions', width: 170 }
]
const shortAddr = (s: string): string => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s)
const timeoutText = (m: number): string => (m % 1440 === 0 ? `${m / 1440} 天` : m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`)
const desktopAgo = computed(() => {
  const o = overview.value
  if (!o?.desktop) return null
  return Math.round((Date.parse(o.now.replace(' ', 'T')) - Date.parse(o.desktop.at.replace(' ', 'T'))) / 60000)
})
const unsettledTotal = computed(() => Math.max(0, n(overview.value?.settle?.due) - n(overview.value?.settle?.settled)))

/** 跳到批次页，带客户 / 结算状态筛选 */
function clientOrders(id: number, settle?: string): void {
  orderClient.value = id
  orderSettle.value = settle
  tab.value = 'orders'
}
/** 结算页点批次号：切到批次页并打开详情 */
async function openOrder(id: number): Promise<void> {
  tab.value = 'orders'
  await nextTick()
  ordersPane.value?.open(id)
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0)
const money = (v: string | number | null | undefined, sym: string): string => `${sym}${n(v).toFixed(2)}`
const short = (v: string | null): string => (v ? v.slice(5, 16) : '-')

function viewLinks(client: AdminClient): void {
  linkClient.value = client.id
  tab.value = 'links'
}

async function kick(client: AdminClient): Promise<void> {
  try {
    await paylinksAdmin.kickClient(client.id)
    message.success(`${client.username} 已被强制下线`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  }
}

function remove(client: AdminClient): void {
  confirmDanger({
    title: `删除客户 ${client.username}`,
    content: n(client.paid)
      ? '这个客户有已付款记录，不能删除（结算会对不上），请改为停用。'
      : '删除后该账号不能再登录；手里还没付的链接会收回并换成新链接。',
    okText: '删除',
    onOk: async () => {
      try {
        await paylinksAdmin.deleteClient(client.id)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e))
      }
    }
  })
}

function onLinksChanged(_links: AdminLink[]): void {
  void load()
}
</script>

<template>
  <div class="pane">
    <a-result
      v-if="!configured"
      status="info"
      title="还没有连上代付链接网站"
      sub-title="先在右上角「网站同步」里填好网站地址和同步密钥，这里才能管理客户。"
    >
      <template #extra>
        <a-button type="primary" @click="emit('open-sync')">去设置</a-button>
      </template>
    </a-result>

    <template v-else>
      <a-alert v-if="error" type="error" show-icon :message="`读取网站数据失败：${error}`">
        <template #action><a-button size="small" @click="load">重试</a-button></template>
      </a-alert>

      <a-tabs v-model:active-key="tab" class="tabs">
        <!-- 总览 -->
        <a-tab-pane key="overview" tab="总览">
          <div class="tab-body">
            <a-alert v-if="overview && (desktopAgo === null || desktopAgo > 10)" type="warning" show-icon
              :message="overview.desktop ? `桌面端 ${desktopAgo} 分钟没同步了（最后 ${overview.desktop.at}）` : '还没有收到过桌面端同步'"
              description="补货、换新、确认付款都要桌面端开着并打开「网站同步」。" />
            <a-alert v-if="overview?.stuck_checking" type="warning" show-icon :message="`${overview.stuck_checking} 条确认中超过 30 分钟`"
              description="多半是对应账号已不在桌面端，可在批次详情或链接页手动定性。" />
            <div class="stat-grid">
              <a-card v-for="(meta, key) in LINK_STATUS_META" :key="key" size="small" class="stat-card">
                <div class="stat-label"><a-tag :color="meta.color" :bordered="false">{{ meta.text }}</a-tag></div>
                <div class="stat-value">{{ statusTotals[key]?.n ?? 0 }}</div>
                <div class="stat-sub muted">{{ money(statusTotals[key]?.usd, '$') }} · {{ money(statusTotals[key]?.cny, '¥') }}</div>
              </a-card>
              <a-card size="small" class="stat-card">
                <div class="stat-label"><a-tag color="green" :bordered="false">今日已付</a-tag></div>
                <div class="stat-value">{{ paidToday }}</div>
                <div class="stat-sub muted">Stripe 最近检查 {{ overview?.last_stripe_check ? overview.last_stripe_check.slice(11) : '-' }}</div>
              </a-card>
              <a-card size="small" class="stat-card">
                <div class="stat-label"><a-tag color="blue" :bordered="false">已结 / 应结</a-tag></div>
                <div class="stat-value">{{ money(overview?.settle?.settled, '$') }}</div>
                <div class="stat-sub muted">应结 {{ money(overview?.settle?.due, '$') }} · 未结 <b :class="unsettledTotal > 0 ? 'warn' : ''">{{ money(unsettledTotal, '$') }}</b></div>
              </a-card>
            </div>
            <a-card v-if="dailyRows.length" size="small" title="近 14 天已付款">
              <div class="daily">
                <a-tooltip v-for="d in dailyRows" :key="d.day" :title="d.parts.join('，')">
                  <span class="daily-item"><b>{{ d.n }}</b>{{ d.day.slice(5) }}</span>
                </a-tooltip>
              </div>
            </a-card>
          </div>
        </a-tab-pane>

        <!-- 批次 -->
        <a-tab-pane key="orders" tab="批次">
          <PaylinksOrdersPane ref="ordersPane" v-model:client-id="orderClient" v-model:settle="orderSettle" :clients="clients" :active="props.active && tab === 'orders'" @changed="load" />
        </a-tab-pane>

        <!-- 结算 -->
        <a-tab-pane key="settlements">
          <template #tab>结算<a-badge v-if="overview?.settle?.unsettled_orders" :count="overview.settle.unsettled_orders" :offset="[6, -2]" size="small" /></template>
          <PaylinksSettlementsPane :clients="clients" :active="props.active && tab === 'settlements'" @changed="load"
            @open-order="openOrder" @client-orders="(id: number) => clientOrders(id, 'unsettled')" />
        </a-tab-pane>

        <!-- 客户 -->
        <a-tab-pane key="clients" tab="客户">
      <a-card size="small" :title="`客户账号（${clients.length}）`">
        <template #extra>
          <a-space>
            <a-button size="small" :loading="loading" @click="load">
              <template #icon><ReloadOutlined /></template>刷新
            </a-button>
            <a-button size="small" type="primary" @click="editing = null">
              <template #icon><PlusOutlined /></template>新建客户
            </a-button>
          </a-space>
        </template>
        <a-table
          :columns="columns"
          :data-source="clients"
          :row-key="(r: AdminClient) => r.id"
          :pagination="false"
          size="small"
          :loading="loading && !clients.length"
          :locale="{ emptyText: '还没有客户，点右上角新建' }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <div class="name">{{ record.display_name || record.username }}</div>
              <div class="muted small">
                {{ record.username }}<template v-if="record.note"> · {{ record.note }}</template>
              </div>
            </template>
            <template v-else-if="column.key === 'enabled'">
              <a-tag :color="record.enabled ? 'green' : 'default'" :bordered="false">
                {{ record.enabled ? '启用' : '已停用' }}
              </a-tag>
            </template>
            <template v-else-if="column.key === 'wallet'">
              <template v-if="record.wallet_address">
                <span class="small muted">{{ networkName(record.wallet_network) }} · {{ record.wallet_token }}</span>
                <div>
                  <a-tooltip :title="record.wallet_address"><span class="mono small">{{ shortAddr(record.wallet_address) }}</span></a-tooltip>
                  <a-button type="link" size="small" @click="copyText(record.wallet_address, '已复制地址')"><template #icon><CopyOutlined /></template></a-button>
                </div>
                <a-tag v-if="record.wallet_network !== 'polygon'" color="red" :bordered="false">不是 Polygon，让客户重填</a-tag>
                <a-tag v-else-if="walletFresh(record.wallet_updated_at)" color="red" :bordered="false">24 小时内改过</a-tag>
              </template>
              <a-tag v-else color="orange" :bordered="false">未设置</a-tag>
            </template>
            <template v-else-if="column.key === 'claimed'">{{ n(record.claimed) }}</template>
            <template v-else-if="column.key === 'paid'">
              {{ n(record.paid) }}<div class="muted small">今日 <b class="ok">{{ n(record.paid_today) }}</b></div>
            </template>
            <template v-else-if="column.key === 'amount'">
              <div>{{ money(record.due, '$') }}<span v-if="record.unit_price != null" class="muted small"> · 每条 {{ money(record.unit_price, '$') }}</span></div>
              <div class="small" :class="n(record.unsettled) > 0 ? 'warn' : 'muted'">未结 {{ money(record.unsettled, '$') }}</div>
            </template>
            <template v-else-if="column.key === 'rule'">
              <span class="small">每次 ≤ {{ record.max_claim }} 条 · {{ timeoutText(record.claim_timeout_minutes) }}</span>
            </template>
            <template v-else-if="column.key === 'login'">
              <span class="small">{{ short(record.last_login_at) }}</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-space :size="0">
                <a-tooltip title="他的批次">
                  <a-button type="text" size="small" @click="clientOrders(record.id)"><template #icon><UnorderedListOutlined /></template></a-button>
                </a-tooltip>
                <a-tooltip title="他的链接">
                  <a-button type="text" size="small" @click="viewLinks(record)"><template #icon><LinkOutlined /></template></a-button>
                </a-tooltip>
                <a-tooltip title="编辑 / 改密码 / 收款地址 / 停用">
                  <a-button type="text" size="small" @click="editing = record"><template #icon><EditOutlined /></template></a-button>
                </a-tooltip>
                <a-tooltip title="强制下线（要求重新登录）">
                  <a-button type="text" size="small" @click="kick(record)"><template #icon><LogoutOutlined /></template></a-button>
                </a-tooltip>
                <a-tooltip title="删除">
                  <a-button type="text" size="small" danger @click="remove(record)"><template #icon><DeleteOutlined /></template></a-button>
                </a-tooltip>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-card>
        </a-tab-pane>

        <!-- 链接 -->
        <a-tab-pane key="links" tab="链接">
          <PaylinksLinksPane v-model:client-id="linkClient" :clients="clients" :active="props.active && tab === 'links'" @changed="onLinksChanged" />
        </a-tab-pane>

        <!-- 日志 -->
        <a-tab-pane key="logs" tab="日志">
          <PaylinksLogsPane :active="props.active && tab === 'logs'" />
        </a-tab-pane>
      </a-tabs>
    </template>

    <PaylinksClientModal
      v-if="editing !== undefined"
      :client="editing"
      :site-url="settingsStore.settings.paylinksServerUrl"
      @saved="load"
      @close="editing = undefined"
    />
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; gap: 16px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat-card :deep(.ant-card-body) { display: flex; flex-direction: column; gap: 4px; }
.stat-value { font-size: 24px; font-weight: 600; line-height: 1.2; }
.stat-sub { font-size: 12px; }
.daily { display: flex; flex-wrap: wrap; gap: 8px; }
.daily-item {
  display: inline-flex; flex-direction: column; align-items: center; min-width: 52px;
  padding: 4px 8px; border-radius: 8px; background: var(--kal-block-bg); font-size: 12px;
}
.daily-item b { font-size: 16px; color: #52c41a; }
.name { font-weight: 600; }
.tabs :deep(.ant-tabs-nav) { margin-bottom: 12px; }
.tab-body { display: flex; flex-direction: column; gap: 16px; }
.mono { font-family: ui-monospace, Consolas, monospace; }
.warn { color: #fa8c16; }
.ok { color: #52c41a; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
</style>
