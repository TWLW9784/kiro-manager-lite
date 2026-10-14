<script setup lang="ts">
/** 总览：桌面端状态、各状态汇总、客户结算概况、近 14 天已付款 */
import { computed } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { guard } from '@site/shared/api'
import { LINK_STATUS, num, short, usd, walletFresh } from '@site/shared/format'
import { clients, desktopAgo, loadClients, loadOverview, overview, type AdminClient } from '../state'

const emit = defineEmits<{ goto: [view: 'orders' | 'settlements' | 'links', params?: Record<string, unknown>] }>()

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
const unsettledTotal = computed(() => Math.max(0, num(overview.value?.settle.due) - num(overview.value?.settle.settled)))

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

const reload = (): void =>
  void guard(async () => {
    await Promise.all([loadOverview(), loadClients()])
  })
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
      <div class="stat-label"><el-tag size="small" type="primary">已结 / 应付客户</el-tag></div>
      <div class="stat-value primary">{{ usd(overview?.settle.settled) }}</div>
      <div class="stat-sub">
        <span class="nowrap">应付 {{ usd(overview?.settle.due) }}</span> ·
        <span class="nowrap">
          未结 <b :class="unsettledTotal > 0 ? 'warn' : ''">{{ usd(unsettledTotal) }}</b>
        </span>
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

  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <h2>客户结算概况</h2>
        <el-button size="small" @click="emit('goto', 'settlements')">去结算</el-button>
        <el-button size="small" :icon="Refresh" @click="reload" />
      </div>
    </template>
    <el-table :data="clients" size="small">
      <el-table-column label="客户" min-width="140">
        <template #default="{ row }">
          <b>{{ row.display_name || row.username }}</b>
          <div class="muted small">{{ row.username }}</div>
        </template>
      </el-table-column>
      <el-table-column label="待付" width="72" align="right">
        <template #default="{ row }">{{ num(row.claimed) }}</template>
      </el-table-column>
      <el-table-column label="已付" width="100" align="right">
        <template #default="{ row }">
          {{ num(row.paid) }}
          <div class="muted small">今日 {{ num(row.paid_today) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="付客户" width="110" align="right">
        <template #default="{ row }">
          <span class="num">{{ usd(row.due) }}</span>
          <div v-if="row.unit_price !== null" class="muted small">每条 {{ usd(row.unit_price) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="客户实付" width="96" align="right">
        <template #default="{ row }"><span class="muted num">{{ usd(row.client_paid) }}</span></template>
      </el-table-column>
      <el-table-column label="客户赚" width="96" align="right">
        <template #default="{ row }">
          <b :class="num(row.client_profit) >= 0 ? 'ok' : 'danger'">{{ usd(row.client_profit) }}</b>
        </template>
      </el-table-column>
      <el-table-column label="已付客户" width="100" align="right">
        <template #default="{ row }"><span class="ok num">{{ usd(row.settled) }}</span></template>
      </el-table-column>
      <el-table-column label="余额" width="110" align="right">
        <template #default="{ row }">
          <el-tag v-if="Math.abs(num(row.balance)) < 0.005" size="small" type="success">已结清</el-tag>
          <template v-else-if="num(row.balance) > 0">
            <b class="primary">+{{ num(row.balance).toFixed(2) }}</b>
            <div class="muted small">已预付</div>
          </template>
          <template v-else>
            <b class="warn">{{ usd(-num(row.balance)) }}</b>
            <div class="muted small">待结算</div>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="收款地址" min-width="180">
        <template #default="{ row }">
          <template v-if="row.wallet_address">
            <el-tooltip :content="row.wallet_address" placement="top">
              <span class="mono">{{ short(row.wallet_address) }}</span>
            </el-tooltip>
            <el-tag v-if="row.wallet_network !== 'polygon'" size="small" type="danger">不是 Polygon</el-tag>
            <el-tag v-else-if="walletFresh(row.wallet_updated_at)" size="small" type="danger">24h 内改过</el-tag>
          </template>
          <el-tag v-else size="small" type="warning">未设置</el-tag>
        </template>
      </el-table-column>
      <el-table-column min-width="100" align="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="emit('goto', 'orders', { clientId: row.id, settle: 'unsettled' })">
            未结批次
          </el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="还没有客户" /></template>
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
</style>
