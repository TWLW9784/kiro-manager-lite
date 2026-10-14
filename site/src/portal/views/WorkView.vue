<script setup lang="ts">
/** 付款工作台：打开就能看到待付款链接，能领的批次直接在上面领 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import PaylinkUrl from '@site/shared/PaylinkUrl.vue'
import { api, guard } from '@site/shared/api'
import { copyText, cny, num, usd } from '@site/shared/format'
import { useViewport } from '@site/shared/responsive'
import { tt, t, lang } from '../i18n'
import { claimRule, loadMe, me, walletIssue } from '../state'
import OrderDrawer from '../components/OrderDrawer.vue'

const emit = defineEmits<{ goto: [view: 'wallet'] }>()

interface PendingLink {
  id: number
  url: string
  tier: string
  amount_due: string | null
  amount_cny: string | null
  status: string
  claimed_at: string
  expires_in: number
  order_id: number | null
  code: string | null
  source: string | null
}
interface Order {
  id: number
  code: string
  tier: string
  quantity: number
  paid: string
  holding: string
  remaining: number
  source: string
  status: string
}

const loading = ref(false)
const rows = ref<PendingLink[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
// 用 0 代表「全部批次」：Element Plus 把空串当成「没选」，会退回显示 placeholder
const ALL = 0
const orderFilter = ref<number>(ALL)
/** 发给接口时还原成空值，服务端拿到的东西和以前一样 */
const orderParam = (): number | '' => (orderFilter.value === ALL ? '' : orderFilter.value)
const openOrders = ref<Order[]>([])
const selected = ref<PendingLink[]>([])
const fresh = ref(new Set<number>())
const claimCount = ref<Record<number, number>>({})
const drawerOrder = ref<number | null>(null)
const tableRef = ref()

// 窄屏改用卡片列表：这张表完整要 834px，390px 手机上 61% 的内容
// （包括「打开付款」按钮）在屏幕外，必须横向拖动才点得到
const { width: vw } = useViewport()
const compact = computed(() => vw.value <= 860)

/** 卡片模式下的勾选。复用同一个 selected，工具栏那几个批量操作不用改 */
const pickedIds = computed({
  get: () => selected.value.map((r) => r.id),
  set: (ids: number[]) => {
    const keep = new Set(ids)
    selected.value = rows.value.filter((r) => keep.has(r.id))
  }
})
const selectableRows = computed(() => rows.value.filter((r) => r.status === 'claimed'))
const allPicked = computed(
  () => !!selectableRows.value.length && pickedIds.value.length === selectableRows.value.length
)
function toggleAll(v: boolean): void {
  pickedIds.value = v ? selectableRows.value.map((r) => r.id) : []
}

const stats = computed(() => me.value?.stats)
const claimable = computed(() => openOrders.value.filter((o) => num(o.remaining) > 0))
const maxClaim = computed(() => me.value?.max_claim ?? 50)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [orders, claimed] = await Promise.all([
      api.get<{ orders: Order[] }>('my_orders', { page: 1, page_size: 50, status: 'open' }),
      api.get<{ links: PendingLink[]; total: number }>('my_claimed', {
        page: page.value,
        page_size: size.value,
        order_id: orderParam()
      })
    ])
    openOrders.value = orders.orders
    rows.value = claimed.links
    total.value = claimed.total
    for (const o of claimable.value) claimCount.value[o.id] ??= Math.min(num(o.remaining), maxClaim.value)
    // 领到的自动勾上
    if (fresh.value.size) {
      const keep = rows.value.filter((r) => fresh.value.has(r.id))
      for (const r of keep) tableRef.value?.toggleRowSelection(r, true)
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => void guard(load))

async function claim(order: Order): Promise<void> {
  const n = Math.max(1, Math.min(num(claimCount.value[order.id]), maxClaim.value))
  await guard(async () => {
    const r = await api.post<{ claimed: number; short: number; ids: number[] }>('claim', {
      order_id: order.id,
      count: n
    })
    fresh.value = new Set(r.ids)
    ElMessage({
      type: r.claimed ? 'success' : 'info',
      message: r.claimed ? t('claimed_ok', { n: r.claimed }) + (r.short ? t('claimed_short', { n: r.short }) : '') : t('waiting_stock')
    })
    page.value = 1
    orderFilter.value = ALL
    await Promise.all([loadMe(), load()])
  })
}

async function copyAll(): Promise<void> {
  await guard(async () => {
    const all = await api.get<{ links: PendingLink[] }>('my_claimed', { page: 1, page_size: 500, order_id: orderParam() })
    const urls = all.links.filter((l) => l.status === 'claimed').map((l) => l.url)
    if (!urls.length) return ElMessage.info(t('no_claimed'))
    await copyText(urls.join('\n'))
    ElMessage.success(t('copied', { n: urls.length }))
  })
}

const picked = computed(() => selected.value.filter((l) => l.status === 'claimed'))

async function copySelected(): Promise<void> {
  if (!picked.value.length) {
    ElMessage.info(t('pick_links'))
    return
  }
  await copyText(picked.value.map((l) => l.url).join('\n'))
  ElMessage.success(t('copied', { n: picked.value.length }))
}

function exportTxt(): void {
  if (!picked.value.length) {
    ElMessage.info(t('pick_links'))
    return
  }
  const time = new Date().toLocaleString()
  const body = `${t('txt_header', { n: picked.value.length, time })}\n\n${picked.value.map((r, i) => `${i + 1}. ${r.url}`).join('\n')}\n`
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' })),
    download: t('txt_file', { n: picked.value.length, time: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') })
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function release(): Promise<void> {
  if (!picked.value.length) {
    ElMessage.info(t('pick_links'))
    return
  }
  try {
    await ElMessageBox.confirm(t('release_confirm', { n: picked.value.length }), t('release_selected'), {
      type: 'warning',
      confirmButtonText: t('release_selected'),
      cancelButtonText: t('cancel')
    })
  } catch {
    return
  }
  await guard(async () => {
    const r = await api.post<{ released: number }>('release', { ids: picked.value.map((l) => l.id) })
    ElMessage.success(t('released', { n: r.released }))
    await Promise.all([loadMe(), load()])
  })
}

async function replace(link: PendingLink): Promise<void> {
  try {
    await ElMessageBox.confirm(t('replace_confirm'), t('replace'), {
      confirmButtonText: t('replace'),
      cancelButtonText: t('cancel')
    })
  } catch {
    return
  }
  await guard(async () => {
    const r = await api.post<{ new_id: number | null }>('replace', { id: link.id })
    ElMessage.success(r.new_id ? t('replaced_ok') : t('replaced_wait'))
    await load()
  })
}

function left(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h >= 24) return t('left_d', { d: Math.floor(h / 24), h: h % 24 })
  return h ? t('left_hm', { h, m }) : t('left_m', { m })
}
const rowClass = ({ row }: { row: PendingLink }): string => (fresh.value.has(row.id) ? 'fresh-row' : '')
</script>

<template>
  <el-alert
    v-if="walletIssue === 'missing'"
    type="warning"
    show-icon
    :closable="false"
    :title="tt('wallet_missing')"
    :description="tt('wallet_missing_tip')"
  >
    <el-button size="small" type="primary" @click="emit('goto', 'wallet')">{{ tt('wallet_set') }}</el-button>
  </el-alert>
  <el-alert
    v-else-if="walletIssue === 'network'"
    type="error"
    show-icon
    :closable="false"
    :title="tt('wallet_wrong_network', { name: me?.client.wallet_network_name ?? '' })"
    :description="tt('wallet_wrong_network_tip')"
  >
    <el-button size="small" type="primary" @click="emit('goto', 'wallet')">{{ tt('wallet_edit') }}</el-button>
  </el-alert>

  <div v-if="stats" class="stats">
    <el-card shadow="never" body-class="stat-body">
      <div class="stat-label">{{ tt('stat_pending') }}</div>
      <div class="stat-value warn">{{ stats.claimed + stats.checking }}</div>
      <div class="stat-sub">{{ stats.checking ? tt('stat_checking_n', { n: stats.checking }) : tt('stat_pending_sub') }}</div>
    </el-card>
    <el-card shadow="never" body-class="stat-body">
      <div class="stat-label">{{ tt('stat_paid') }}</div>
      <div class="stat-value ok">{{ stats.paid }}</div>
      <div class="stat-sub">{{ tt('stat_today_n', { n: stats.paid_today }) }}</div>
    </el-card>
    <el-card shadow="never" body-class="stat-body">
      <div class="stat-label">{{ tt('stat_due') }}</div>
      <div class="stat-value">{{ usd(stats.due) }}</div>
      <div class="stat-sub">{{ tt('stat_paid_out_n', { n: usd(stats.paid_usd) }) }}</div>
    </el-card>
    <el-card shadow="never" body-class="stat-body">
      <div class="stat-label">{{ tt('stat_settled') }}</div>
      <div class="stat-value primary">{{ usd(stats.settled) }}</div>
      <div class="stat-sub">
        {{ num(stats.prepaid) > 0.004 ? tt('stat_prepaid_n', { n: usd(stats.prepaid) }) : tt('stat_unsettled_n', { n: usd(stats.unsettled) }) }}
      </div>
    </el-card>
    <el-card shadow="never" body-class="stat-body">
      <div class="stat-label">{{ tt('stat_profit') }}</div>
      <div class="stat-value ok">{{ usd(stats.profit) }}</div>
      <div class="stat-sub">{{ tt('stat_profit_sub') }}</div>
    </el-card>
  </div>

  <!-- 领取 -->
  <el-card v-if="claimable.length" shadow="never">
    <template #header>
      <div class="card-head">
        <h2>{{ tt('claim_title') }}</h2>
        <span class="muted small">{{ tt('claim_hint') }} {{ claimRule }}</span>
      </div>
    </template>
    <div v-for="o in claimable" :key="o.id" class="claim-row">
      <div class="claim-info">
        <div>
          <b>{{ o.code }}</b>
          <el-tag size="small" class="tier-tag">{{ o.tier }}</el-tag>
        </div>
        <div class="muted small">
          {{ tt('target_progress', { qty: o.quantity, paid: num(o.paid), holding: num(o.holding), remaining: num(o.remaining) }) }}
        </div>
        <el-progress :percentage="Math.min(100, Math.round((num(o.paid) / Math.max(1, o.quantity)) * 100))" :show-text="false" />
      </div>
      <el-input-number
        v-model="claimCount[o.id]"
        :min="1"
        :max="Math.min(num(o.remaining), maxClaim)"
        size="default"
        controls-position="right"
        class="claim-count"
      />
      <el-button type="primary" @click="claim(o)">{{ tt('claim') }}</el-button>
    </div>
  </el-card>
  <el-alert
    v-else-if="!openOrders.length"
    type="info"
    show-icon
    :closable="false"
    :title="tt('no_open_orders')"
    :description="tt('no_orders_tip')"
  />

  <!-- 待付款 -->
  <el-card shadow="never" id="pending-card">
    <template #header>
      <div class="card-head">
        <h2>
          {{ tt('pending_title') }}
          <el-tag v-if="total" type="warning" size="small">{{ total }}</el-tag>
        </h2>
        <el-button type="primary" :disabled="!total" @click="copyAll">
          {{ tt('copy_all_pending', { n: total }) }}
        </el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load" />
      </div>
    </template>

    <div class="toolbar">
      <el-select v-model="orderFilter" class="w-200" @change="(page = 1), load()">
        <el-option :value="ALL" :label="tt('all_orders')" />
        <el-option
          v-for="o in openOrders.filter((x) => num(x.holding))"
          :key="o.id"
          :value="o.id"
          :label="`${o.code}（${num(o.holding)}）`"
        />
      </el-select>
      <span class="muted small">{{ tt('selected_n', { n: picked.length }) }}</span>
      <el-button :disabled="!picked.length" @click="copySelected">{{ tt('copy_selected') }}</el-button>
      <el-button :disabled="!picked.length" @click="exportTxt">{{ tt('export_txt') }}</el-button>
      <el-button type="danger" plain :disabled="!picked.length" @click="release">{{ tt('release_selected') }}</el-button>
    </div>

    <!-- 手机：卡片列表。一条链接一张卡，链接和按钮都在一屏内 -->
    <div v-if="compact" v-loading="loading" class="link-cards">
      <el-checkbox
        v-if="selectableRows.length"
        class="pick-all"
        :model-value="allPicked"
        :indeterminate="!!pickedIds.length && !allPicked"
        @change="(v: boolean | string | number) => toggleAll(!!v)"
      >
        {{ tt('select_all') }}
      </el-checkbox>
      <el-checkbox-group v-model="pickedIds" class="card-group">
        <article v-for="row in rows" :key="row.id" class="link-card" :class="{ 'is-fresh': fresh.has(row.id) }">
          <div class="card-top">
            <el-checkbox :value="row.id" :disabled="row.status !== 'claimed'" :aria-label="row.code ?? ''" />
            <PaylinkUrl :url="row.url" :tip="tt('click_copy')" :copied="tt('copied', { n: 1 })" />
          </div>
          <div class="card-meta">
            <el-link v-if="row.order_id" type="primary" :underline="false" @click="drawerOrder = row.order_id">
              {{ row.code }}
            </el-link>
            <span v-else class="muted">-</span>
            <span class="muted small">{{ row.tier }}</span>
            <span class="num grow right">{{ usd(row.amount_due) }}</span>
          </div>
          <div class="card-foot">
            <el-tag v-if="row.status === 'checking'" type="warning" size="small">{{ tt('link_checking') }}</el-tag>
            <span v-else :class="['small', row.expires_in < 3600 ? 'warn' : 'muted']">{{ left(row.expires_in) }}</span>
            <span class="grow"></span>
            <el-button
              v-if="row.status === 'claimed' && row.order_id && row.source !== 'offline'"
              size="small"
              text
              @click="replace(row)"
            >
              {{ tt('replace') }}
            </el-button>
            <el-button size="small" type="primary" plain tag="a" :href="row.url" target="_blank" rel="noopener noreferrer">
              {{ tt('open_pay') }}
            </el-button>
          </div>
        </article>
      </el-checkbox-group>
      <el-empty
        v-if="!rows.length && !loading"
        :description="claimable.length ? tt('no_claimed_claim_tip') : tt('no_claimed')"
      />
    </div>

    <el-table
      v-else
      ref="tableRef"
      v-loading="loading"
      :data="rows"
      :row-class-name="rowClass"
      size="large"
      @selection-change="(v: PendingLink[]) => (selected = v)"
    >
      <el-table-column type="selection" width="44" :selectable="(r: PendingLink) => r.status === 'claimed'" />
      <el-table-column :label="tt('col_link')" min-width="200">
        <template #default="{ row }">
          <PaylinkUrl :url="row.url" :tip="tt('click_copy')" :copied="tt('copied', { n: 1 })" />
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_batch')" width="150">
        <template #default="{ row }">
          <el-link v-if="row.order_id" type="primary" :underline="false" @click="drawerOrder = row.order_id">
            {{ row.code }}
          </el-link>
          <span v-else>-</span>
          <div class="muted small">{{ row.tier }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_amount')" width="120" align="right">
        <template #default="{ row }">
          <div class="num">{{ usd(row.amount_due) }}</div>
          <div v-if="num(row.amount_cny)" class="muted small">{{ cny(row.amount_cny) }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="tt('col_left')" width="130">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'checking'" type="warning" size="small">{{ tt('link_checking') }}</el-tag>
          <span v-else :class="['small', row.expires_in < 3600 ? 'warn' : 'muted']">{{ left(row.expires_in) }}</span>
        </template>
      </el-table-column>
      <el-table-column width="190" align="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" plain tag="a" :href="row.url" target="_blank" rel="noopener noreferrer">
            {{ tt('open_pay') }}
          </el-button>
          <el-button
            v-if="row.status === 'claimed' && row.order_id && row.source !== 'offline'"
            size="small"
            text
            @click="replace(row)"
          >
            {{ tt('replace') }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="claimable.length ? tt('no_claimed_claim_tip') : tt('no_claimed')" />
      </template>
    </el-table>

    <div v-if="total > size" class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next"
        background
        @change="load"
      />
    </div>
  </el-card>

  <OrderDrawer v-if="drawerOrder" :order-id="drawerOrder" @close="drawerOrder = null" @changed="load" />
</template>

<style scoped>
.claim-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.claim-row:last-child { border-bottom: none; }
.claim-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tier-tag { margin-left: 8px; }
.claim-count { width: 120px; }
:deep(.fresh-row) { background: var(--el-color-success-light-9); }

/* ---- 手机卡片列表 ---- */
.link-cards { display: flex; flex-direction: column; gap: 10px; }
.pick-all { margin: 2px 0 0; }
.card-group { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.link-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--el-bg-color);
}
.link-card.is-fresh { background: var(--el-color-success-light-9); border-color: var(--el-color-success-light-7); }
.card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.card-top :deep(.paylink) { flex: 1 1 auto; min-width: 0; }
.card-meta, .card-foot { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 手机上要点得准：size="small" 默认只有 24px 高 */
.card-foot :deep(.el-button--small) { height: 34px; padding: 8px 12px; }
.card-top :deep(.el-checkbox) { padding: 8px; margin: -8px; }
/* el-checkbox-group 默认是行内排布，这里要让每张卡占满一行 */
.card-group :deep(.el-checkbox) { margin-right: 0; height: auto; }

@media (max-width: 900px) {
  .claim-row { flex-wrap: wrap; }
  .claim-info { flex-basis: 100%; }
  .claim-count { flex: 1 1 auto; width: auto; }
}
</style>
