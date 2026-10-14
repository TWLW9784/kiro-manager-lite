<script setup lang="ts">
/** 总览：要处理的事、各状态汇总、进行中的批次、近 14 天已付款 */
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { api, guard } from '@site/shared/api'
import { LINK_STATUS, num, usd, walletFresh } from '@site/shared/format'
import { clients, desktopAgo, loadClients, loadOverview, overview, type AdminClient, type AdminOrder } from '../state'

const emit = defineEmits<{
  goto: [view: 'orders' | 'settlements' | 'links' | 'clients', params?: Record<string, unknown>]
}>()

const totals = computed(() => {
  const out: Record<string, { n: number; usd: number; cny: number }> = {}
  for (const k of Object.keys(LINK_STATUS)) out[k] = { n: 0, usd: 0, cny: 0 }
  for (const r of overview.value?.by_status ?? []) {
    const slot = (out[r.status] ??= { n: 0, usd: 0, cny: 0 })
    slot.n += num(r.n)
    slot.usd += num(r.usd)
    slot.cny += num(r.cny)
  }
  return out
})
const today = computed(() => (overview.value?.now ?? '').slice(0, 10))
const paidToday = computed(() =>
  (overview.value?.daily ?? []).filter((d) => d.day === today.value).reduce((n, d) => n + num(d.n), 0)
)
/**
 * 你欠客户的、你预付在外的：按客户分别算再加总。
 * 原来是「全部应付 − 全部已付」，一个客户的预付会把另一个客户的欠款抵掉
 * （client 预付 $108 把 客户2 $80 + kycduke $44 抵成了「未结 $0」），
 * 而那两笔钱其实还得付。
 */
const owedTotal = computed(() => clients.value.reduce((s, c) => s + Math.max(0, -num(c.balance)), 0))
const prepaidTotal = computed(() => clients.value.reduce((s, c) => s + Math.max(0, num(c.balance)), 0))

/**
 * 近 14 天：客户 × 日期。
 * 日期列固定是完整的 14 天（最新在前），没付款的那天显示「–」：只列有数据的
 * 日子时，才两天数据就只有两列，客户那一列占了整张表 89% 的宽度；而且看不出
 * 哪天断了。服务端也是按 CURDATE() 往前 13 天取的数，这里对齐。
 */
const days = computed(() => {
  const end = today.value
  if (!end) return [] as string[]
  const [y, m, d] = end.split('-').map(Number)
  // 用 UTC 推日期，避免本地时区把日子算偏
  return Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10))
})
/** 按 client_id 归行（不是按名字：重名的两个客户不能合成一行）；没有客户的是线下发出、没分配的链接 */
const perClient = computed(() => {
  const out = new Map<string, { name: string; byDay: Record<string, number>; total: number; none: boolean }>()
  for (const d of overview.value?.daily ?? []) {
    const none = d.client_id === null
    const key = none ? 'none' : String(d.client_id)
    // 「未分配客户」只给真的没有客户的行。有客户但名字为空时退回编号，
    // 不能也写成「未分配客户」—— 之前 kycduke 就因此和真正未分配的混成两行同名
    const name = none ? '未分配客户' : d.client || `客户 #${d.client_id}`
    const row = out.get(key) ?? { name, byDay: {}, total: 0, none }
    row.byDay[d.day] = (row.byDay[d.day] ?? 0) + num(d.n)
    row.total += num(d.n)
    out.set(key, row)
  }
  // 付得多的排前面，「未分配客户」放最后
  return [...out.values()].sort((a, b) => Number(a.none) - Number(b.none) || b.total - a.total)
})

/** 进行中的批次（总览只列一个短表，详情去批次页） */
const openOrders = ref<AdminOrder[]>([])
async function loadOpen(): Promise<void> {
  openOrders.value = (await api.admin<{ orders: AdminOrder[] }>('orders', { status: 'open', page: 1, page_size: 50 })).orders
}
onMounted(() => void guard(loadOpen))

const reload = (): void =>
  void guard(async () => {
    await Promise.all([loadOverview(), loadClients(), loadOpen()])
  })

/**
 * 要处理的事：每条一句话 + 一个按钮。替代原来那张 10 列的「客户结算概况」大表
 * （和客户页完全重复）。桌面端没同步、确认中卡住这两条已经在页面最上方单独提醒。
 */
interface Todo { key: string; level: 'danger' | 'warning' | 'info'; text: string; action: string; go: () => void }
const todos = computed<Todo[]>(() => {
  const out: Todo[] = []
  const busy = new Set(openOrders.value.map((o) => o.client_id))
  const name = (c: AdminClient): string => c.display_name || c.username
  for (const c of clients.value) {
    if (!c.enabled) continue
    const b = num(c.balance)
    const open = (): void => emit('goto', 'clients', { clientId: c.id })
    if (b < -0.004) out.push({ key: `owe${c.id}`, level: 'warning', text: `你欠 ${name(c)} ${usd(-b)}`, action: '去打款', go: open })
    if (c.wallet_address && walletFresh(c.wallet_updated_at))
      out.push({ key: `fresh${c.id}`, level: 'danger', text: `${name(c)} 的收款地址 24 小时内改过，打款前先跟他确认`, action: '查看', go: open })
    if (busy.has(c.id) && !c.wallet_address)
      out.push({ key: `nowal${c.id}`, level: 'info', text: `${name(c)} 有进行中的批次，但还没填收款地址`, action: '查看', go: open })
    else if (busy.has(c.id) && c.wallet_network !== 'polygon')
      out.push({ key: `net${c.id}`, level: 'danger', text: `${name(c)} 填的不是 Polygon 地址，别往这个地址打款`, action: '查看', go: open })
  }
  const rank = { danger: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
})
const pct = (r: AdminOrder): number => Math.min(100, Math.round((num(r.paid) / Math.max(1, r.quantity)) * 100))
const CARDS = ['available', 'claimed', 'checking', 'paid', 'refresh'] as const
</script>

<template>
  <el-alert
    v-if="overview && (desktopAgo === null || desktopAgo > 10)"
    type="error"
    show-icon
    :closable="false"
    :title="overview.desktop ? `桌面端 ${desktopAgo} 分钟没同步了（最后 ${overview.desktop.at}）` : '还没有收到过桌面端同步'"
    description="补货、换新、确认付款都要桌面端开着并打开「网站同步」。"
  />
  <el-alert
    v-if="num(overview?.stuck_checking)"
    type="warning"
    show-icon
    :closable="false"
    :title="`${overview!.stuck_checking} 条确认中超过 30 分钟`"
    description="多半是对应账号已不在桌面端，可在批次详情或链接页手动定性。"
  >
    <el-button size="small" @click="emit('goto', 'links', { linkStatus: 'checking' })">去处理</el-button>
  </el-alert>

  <div class="stats cols-8">
    <el-card v-for="k in CARDS" :key="k" shadow="never">
      <div class="stat-label">
        <el-tag size="small" :type="LINK_STATUS[k].type || undefined">{{ LINK_STATUS[k].text }}</el-tag>
      </div>
      <div class="stat-value">{{ totals[k]?.n ?? 0 }}</div>
      <div class="stat-sub">{{ usd(totals[k]?.usd) }}</div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label"><el-tag size="small" type="success">今日已付</el-tag></div>
      <div class="stat-value ok">{{ paidToday }}</div>
      <div class="stat-sub">Stripe 检查 {{ overview?.last_stripe_check?.slice(11) ?? '-' }}</div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label"><el-tag size="small" type="primary">已付客户</el-tag></div>
      <div class="stat-value primary">{{ usd(overview?.settle.settled) }}</div>
      <div class="stat-sub">
        <span class="nowrap">你欠 <b :class="owedTotal > 0.004 ? 'warn' : ''">{{ usd(owedTotal) }}</b></span> ·
        <span class="nowrap">预付在外 {{ usd(prepaidTotal) }}</span>
      </div>
    </el-card>
    <el-card shadow="never">
      <div class="stat-label"><el-tag size="small">客户实付 Stripe</el-tag></div>
      <div class="stat-value">{{ usd(overview?.settle.client_paid) }}</div>
      <div class="stat-sub">
        <span class="nowrap">客户赚 <b class="ok">{{ usd(overview?.settle.client_profit) }}</b></span>
      </div>
    </el-card>
  </div>

  <!-- 要处理的事：替代原来和客户页重复的「客户结算概况」大表 -->
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>要处理的事<span v-if="todos.length" class="muted small"> {{ todos.length }}</span></h2>
        <el-button size="small" :icon="Refresh" @click="reload" />
      </div>
    </template>
    <ul v-if="todos.length" class="todos">
      <li v-for="t in todos" :key="t.key" :class="t.level">
        <span class="dot" aria-hidden="true" />
        <span class="todo-text">{{ t.text }}</span>
        <el-button size="small" :type="t.level === 'info' ? 'default' : 'primary'" plain @click="t.go">{{ t.action }}</el-button>
      </li>
    </ul>
    <el-empty v-else :image-size="56" description="没有要处理的事" />
  </el-card>

  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>进行中的批次<span class="muted small"> {{ openOrders.length }}</span></h2>
        <el-button size="small" @click="emit('goto', 'orders')">全部批次</el-button>
      </div>
    </template>
    <el-table :data="openOrders" size="small" @row-click="(r: AdminOrder) => emit('goto', 'orders', { orderId: r.id })">
      <el-table-column label="批次" min-width="200">
        <template #default="{ row }">
          <el-link type="primary" :underline="false">{{ row.code }}</el-link>
          <div class="small"><b>{{ row.client ?? '-' }}</b><span class="muted"> · {{ row.tier }}</span></div>
        </template>
      </el-table-column>
      <el-table-column label="进度" min-width="220">
        <template #default="{ row }">
          <el-progress :percentage="pct(row)" :show-text="false" />
          <span class="small muted">完成 <b class="ok">{{ num(row.paid) }}</b> / {{ row.quantity }} · 待付 {{ num(row.holding) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已付 / 完成价值" min-width="150" align="right">
        <template #default="{ row }">
          <span class="num">{{ usd(row.settled_amount) }}</span>
          <div class="muted small">{{ usd(row.due_amount) }}</div>
        </template>
      </el-table-column>
      <template #empty><el-empty :image-size="56" description="没有进行中的批次，去「批次」派单" /></template>
    </el-table>
  </el-card>

  <el-card v-if="perClient.length" shadow="never">
    <template #header><h2 class="head">近 14 天已付款</h2></template>
    <el-table :data="perClient" size="small">
      <!-- 客户列固定宽度并钉在左边：窄屏横向拖动时还能看到是哪个客户 -->
      <el-table-column label="客户" width="140" fixed="left" show-overflow-tooltip>
        <template #default="{ row }">
          <span :class="{ muted: row.none }">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="合计" width="72" align="right">
        <template #default="{ row }"><b class="num">{{ row.total }}</b></template>
      </el-table-column>
      <!-- 日期列平分剩下的宽度 -->
      <el-table-column v-for="d in days" :key="d" :label="d === today ? '今天' : d.slice(5)" min-width="58" align="center">
        <template #default="{ row }">
          <span v-if="row.byDay[d]" class="num">{{ row.byDay[d] }}</span>
          <span v-else class="muted">–</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.head { margin: 0; font-size: 15px; font-weight: 600; }
/* 要处理的事：一行一件，左边圆点标轻重，右边一个按钮 */
.todos { list-style: none; margin: 0; padding: 0; }
.todos li {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter);
}
.todos li:last-child { border-bottom: none; }
.todo-text { flex: 1 1 auto; min-width: 0; line-height: 1.5; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--el-color-info); }
.danger .dot { background: var(--el-color-danger); }
.warning .dot { background: var(--el-color-warning); }
:deep(.el-table__row) { cursor: pointer; }
</style>
