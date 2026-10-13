<script setup lang="ts">
/**
 * 提取记录：所有带支付链接标记的账号。
 *
 * 付款状态由两处信息合成（见 shared/paymentLink）：
 * - Stripe 结算会话状态：付完立刻是 complete，过期是 expired，「检查付款状态」先问它；
 * - Kiro 订阅档位：最终结果，Stripe 已付款的再刷一次用量同步过来。
 * 切到本面板时会自动静默检查一次，失效的链接可以直接「重新提取」。
 *
 * 操作范围与导出弹窗同一个规则：有勾选作用于勾选项，没勾选作用于当前筛选结果。
 */
import { computed, h, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  ClearOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
  SearchOutlined
} from '@ant-design/icons-vue'
import PaymentLinkTxtModal from '@/components/accounts/PaymentLinkTxtModal.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import {
  PAYMENT_LINK_META,
  formatDateTime,
  formatPrice,
  runPool,
  subscriptionLabel,
  subscriptionMeta
} from '@/utils/format'
import { toPlain } from '@/utils/ipc'
import { now } from '@/utils/now'
import { confirmDanger, copyText } from '@/utils/ui'
import {
  amountDueText,
  localDueText,
  buildPaymentLinkSheet,
  displayPaymentUrl,
  paymentLinkFilename,
  paymentLinkText
} from '@/utils/paymentLinks'
import {
  extractPaymentLink,
  priceFields,
  readDiscountSetting,
  type PlanTarget
} from '@/utils/paymentLinkExtract'
import {
  isAwaitingKiroSync,
  isPaidSubscription,
  paymentLinkState,
  paymentLinkTier,
  type PaymentLinkState
} from '@shared/paymentLink'
import type { Account, AccountPaymentLink, CheckoutSessionStatus } from '@shared/types'

/** active：当前是否切到了这个面板，切过来时自动检查一次付款状态 */
const props = defineProps<{ active?: boolean }>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()

const privacy = computed(() => settingsStore.settings.privacyMode)

type StateFilter = 'all' | Exclude<PaymentLinkState, 'none'>
const stateFilter = ref<StateFilter>('all')
const keyword = ref('')
const selectedKeys = ref<string[]>([])

/** 带标记的账号，按提取时间倒序：最新提的在最上面 */
const marked = computed(() =>
  accountsStore.accounts
    .filter((a) => a.paymentLink)
    .sort((a, b) => b.paymentLink!.createdAt - a.paymentLink!.createdAt)
)

const counts = computed(() => {
  const result: Record<StateFilter, number> = { all: 0, pending: 0, expired: 0, paid: 0, other: 0 }
  for (const account of marked.value) {
    result.all++
    const state = paymentLinkState(account, now.value)
    if (state !== 'none') result[state]++
  }
  return result
})

const filterOptions = computed(() => [
  { value: 'all', label: `全部 ${counts.value.all}` },
  { value: 'pending', label: `待付款 ${counts.value.pending}` },
  { value: 'expired', label: `已失效 ${counts.value.expired}` },
  { value: 'paid', label: `已付款 ${counts.value.paid}` },
  { value: 'other', label: `其他档位 ${counts.value.other}` }
])

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return marked.value.filter((a) => {
    if (stateFilter.value !== 'all' && paymentLinkState(a, now.value) !== stateFilter.value) return false
    if (kw && !`${a.email} ${a.nickname ?? ''} ${a.note ?? ''}`.toLowerCase().includes(kw)) return false
    return true
  })
})

/** 勾选项要和当前记录求交：中途清掉标记的账号不能还留在勾选里 */
const selected = computed(() => {
  const set = new Set(selectedKeys.value)
  return marked.value.filter((a) => set.has(a.id))
})

const targets = computed(() => (selected.value.length ? selected.value : visible.value))
const scopeSuffix = computed(() => `（${selected.value.length ? '已选' : ''}${targets.value.length}）`)

const columns = [
  { title: '账号', key: 'email', ellipsis: true },
  { title: '等级 / 实付', key: 'plan', width: 120 },
  { title: '付款状态', key: 'state', width: 120 },
  { title: '当前订阅', key: 'current', width: 100 },
  { title: '提取时间', key: 'createdAt', width: 150 },
  { title: '状态更新', key: 'checkedAt', width: 150 },
  { title: '', key: 'actions', width: 120 }
]

const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  onChange: (keys: (string | number)[]) => (selectedKeys.value = keys.map(String)),
  preserveSelectedRowKeys: true
}))

function stateMeta(account: Account): { text: string; color: string; tip?: string } {
  const state = paymentLinkState(account, now.value)
  const link = account.paymentLink!
  if (isAwaitingKiroSync(account)) {
    return { text: '已付款·待同步', color: 'green', tip: 'Stripe 已显示付款完成，Kiro 的订阅档位还没更新，稍后再检查一次即可' }
  }
  const checked = link.stripeCheckedAt ? `Stripe 确认于 ${formatDateTime(link.stripeCheckedAt)}` : '还没向 Stripe 确认过'
  if (state === 'expired') {
    return { ...PAYMENT_LINK_META.expired, tip: `结算链接已失效，可点「重新提取」生成新链接（${checked}）` }
  }
  return { ...PAYMENT_LINK_META[state], tip: state === 'pending' ? checked : undefined }
}

/** 状态更新时间早于提取时间：Kiro 订阅档位还没在提取之后核对过 */
function uncheckedSinceExtract(account: Account): boolean {
  return (account.lastCheckedAt ?? 0) < account.paymentLink!.createdAt
}

// ============ 检查付款状态 ============

/**
 * 两步走，都不占全局批量任务（全局用量刷新跑着的时候也能点）：
 * 1. 问 Stripe 结算会话状态：一个请求、不需要账号凭证，付完立刻是 complete，失效是 expired；
 * 2. 只对 Stripe 已付款、但 Kiro 档位还是 Free 的账号刷一次用量，把订阅档位同步过来。
 */
const STRIPE_POOL = 8
const KIRO_POOL = 4

const checking = ref(false)
const progress = ref('')
const ProgressText = (): ReturnType<typeof h> => h('span', null, progress.value)
/** 上次检查时间：切到「提取记录」时自动检查一次，2 分钟内不重复 */
const lastCheckedAt = ref(0)
const AUTO_CHECK_INTERVAL_MS = 2 * 60_000

/** 需要问 Stripe 的：还没付（以 Kiro 为准）、也还没被 Stripe 判定为已付 / 已失效的 */
function needsStripeCheck(account: Account): boolean {
  const link = account.paymentLink
  if (!link || isPaidSubscription(account.subscription.type)) return false
  return link.stripeStatus !== 'complete' && link.stripeStatus !== 'expired'
}

/** 正在跑的那次检查；复制 / 导出时撞上自动检查就等它跑完，拿到的才是最新状态 */
let inflight: Promise<void> | null = null

async function checkPayments(list: Account[], silent = false): Promise<void> {
  if (inflight) return inflight
  inflight = runCheck(list, silent).finally(() => {
    inflight = null
  })
  return inflight
}

async function runCheck(list: Account[], silent: boolean): Promise<void> {
  const stripeTargets = list.filter(needsStripeCheck)
  const key = 'payment-link-check'
  checking.value = true
  const paidBefore = counts.value.paid
  const show = (text: string): void => {
    progress.value = text
    if (!silent) message.open({ key, type: 'loading', content: h(ProgressText), duration: 0 })
  }
  let stripeFailed = 0
  let kiroFailed = 0
  try {
    // 第一步：Stripe
    let done = 0
    const updates: {
      id: string
      url: string
      status: CheckoutSessionStatus
      price?: Partial<AccountPaymentLink>
    }[] = []
    /** 会话已不能再付，但分不出是付完了还是失效了，留给第二步按 Kiro 档位定性 */
    const inactive: { id: string; url: string }[] = []
    show(`向 Stripe 确认付款状态 0/${stripeTargets.length}`)
    await runPool(stripeTargets, STRIPE_POOL, async (account) => {
      const url = account.paymentLink!.url
      try {
        const res = await window.api.checkCheckoutStatus(url)
        if (!res.success || !res.data) stripeFailed++
        else if (res.data.status === 'inactive') inactive.push({ id: account.id, url })
        else updates.push({ id: account.id, url, status: res.data.status, price: priceFields(res.data.price) })
      } catch {
        stripeFailed++
      } finally {
        progress.value = `向 Stripe 确认付款状态 ${++done}/${stripeTargets.length}`
      }
    })
    accountsStore.setStripeStatuses(updates)

    // 第二步：Stripe 已付款，或会话已不能再付的，刷一次用量拿 Kiro 最新档位
    const inactiveIds = new Set(inactive.map((item) => item.id))
    const syncTargets = list
      .map((a) => accountsStore.get(a.id))
      .filter((a): a is Account => !!a && (isAwaitingKiroSync(a) || inactiveIds.has(a.id)))
    if (syncTargets.length) {
      done = 0
      show(`同步 Kiro 订阅档位 0/${syncTargets.length}`)
      await runPool(syncTargets, KIRO_POOL, async (account) => {
        try {
          const res = await accountsStore.checkStatus(account.id)
          if (!res.ok) kiroFailed++
        } catch {
          kiroFailed++
        } finally {
          progress.value = `同步 Kiro 订阅档位 ${++done}/${syncTargets.length}`
        }
      })
    }

    // 会话不能再付、Kiro 也还是没订阅：那就是失效了，记成 expired 等着重新提取
    accountsStore.setStripeStatuses(
      inactive
        .filter((item) => {
          const account = accountsStore.get(item.id)
          return account && !isPaidSubscription(account.subscription.type)
        })
        .map((item) => ({ ...item, status: 'expired' as const }))
    )
  } finally {
    message.destroy(key)
    checking.value = false
    lastCheckedAt.value = Date.now()
  }

  if (silent) return
  const paidDelta = counts.value.paid - paidBefore
  const failed = stripeFailed + kiroFailed
  const parts = [
    `确认 ${stripeTargets.length} 条`,
    paidDelta > 0 ? `新增已付款 ${paidDelta}` : '',
    counts.value.expired ? `已失效 ${counts.value.expired}` : '',
    failed ? `失败 ${failed}` : ''
  ].filter(Boolean)
  if (failed) message.warning(`付款状态检查完成：${parts.join('，')}`)
  else message.success(`付款状态检查完成：${parts.join('，')}`)
}

/** 再刷一次 Kiro 档位：用于在别的地方付过款、Stripe 链接却还显示未付的情况 */
async function syncKiro(): Promise<void> {
  if (checking.value) return
  const list = targets.value
  if (!list.length) return
  const key = 'payment-link-kiro'
  checking.value = true
  const paidBefore = counts.value.paid
  let done = 0
  let failed = 0
  progress.value = `刷新 Kiro 订阅档位 0/${list.length}`
  message.open({ key, type: 'loading', content: h(ProgressText), duration: 0 })
  try {
    await runPool(list, KIRO_POOL, async (account) => {
      try {
        if (!(await accountsStore.checkStatus(account.id)).ok) failed++
      } catch {
        failed++
      } finally {
        progress.value = `刷新 Kiro 订阅档位 ${++done}/${list.length}`
      }
    })
  } finally {
    message.destroy(key)
    checking.value = false
  }
  const paidDelta = counts.value.paid - paidBefore
  const text = `Kiro 订阅档位已刷新：成功 ${list.length - failed}${failed ? `，失败 ${failed}` : ''}${
    paidDelta > 0 ? `，新增已开通 ${paidDelta}` : ''
  }`
  if (failed) message.warning(text)
  else message.success(text)
}

/** 切到「提取记录」时静默检查一遍待付款的，付完回来就能看到状态变了 */
watch(
  () => props.active,
  (active) => {
    if (!active || checking.value) return
    if (Date.now() - lastCheckedAt.value < AUTO_CHECK_INTERVAL_MS) return
    const pending = marked.value.filter(needsStripeCheck)
    if (pending.length) void checkPayments(pending, true)
  },
  { immediate: true }
)

// ============ 重新提取 ============

/** 重新提取的范围：有勾选按勾选（已付款的除外），没勾选就是全部已失效的 */
const reExtractTargets = computed(() => {
  if (selected.value.length) {
    return selected.value.filter((a) => {
      const state = paymentLinkState(a, now.value)
      return state === 'pending' || state === 'expired'
    })
  }
  return marked.value.filter((a) => paymentLinkState(a, now.value) === 'expired')
})

const reExtracting = ref(false)

/**
 * 用原来的档位重新生成链接，优惠条件沿用批量提取面板上次的选择。
 * 新链接满足条件就覆盖旧的；不满足（比如优惠已经没了）会记成「无优惠」，旧链接保持失效状态。
 */
async function reExtract(list: Account[]): Promise<void> {
  if (reExtracting.value || !list.length) return
  const setting = readDiscountSetting()
  const key = 'payment-link-reextract'
  reExtracting.value = true
  let done = 0
  const result = { ok: 0, skip: 0, fail: 0 }
  const errors: string[] = []
  progress.value = `重新提取 0/${list.length}`
  message.open({ key, type: 'loading', content: h(ProgressText), duration: 0 })
  try {
    await runPool(
      list,
      KIRO_POOL,
      async (account) => {
        const link = account.paymentLink!
        const target: PlanTarget = {
          subscriptionType: link.subscriptionType,
          title: link.planTitle,
          amount: link.amount,
          currency: link.currency
        }
        const res = await extractPaymentLink(account.id, target, setting)
        result[res.state]++
        if (res.state !== 'ok' && res.error) errors.push(`${account.email}：${res.error}`)
        progress.value = `重新提取 ${++done}/${list.length}`
      },
      { staggerMs: 600 }
    )
  } finally {
    message.destroy(key)
    reExtracting.value = false
  }
  const text = `重新提取完成：成功 ${result.ok}${result.skip ? `，跳过 ${result.skip}` : ''}${
    result.fail ? `，失败 ${result.fail}` : ''
  }`
  if (errors.length) console.warn('[PaymentLink] 重新提取未成功：', errors)
  if (result.fail || result.skip) message.warning(`${text}（原因见系统日志）`)
  else message.success(text)
}

function reExtractOne(account: Account): void {
  void reExtract([account])
}

// ============ 复制 / 导出 / 清除 ============

/**
 * 复制 / 导出给别人付款的链接：先向 Stripe 确认一遍，只交出还能付的（待付款）。
 * 勾选了的按勾选原样输出，用户明确点名的不替他筛。
 */
async function payableTargets(): Promise<{ list: Account[]; dropped: number }> {
  if (selected.value.length) return { list: selected.value, dropped: 0 }
  const unchecked = targets.value.filter(needsStripeCheck)
  if (unchecked.length) await checkPayments(unchecked, true)
  const ids = new Set(targets.value.map((a) => a.id))
  const fresh = marked.value.filter((a) => ids.has(a.id))
  const list = fresh.filter((a) => paymentLinkState(a, Date.now()) === 'pending')
  return { list, dropped: fresh.length - list.length }
}

const preparing = ref(false)

/** 代付 TXT：同样只给还能付款的，确认完再开弹窗 */
const txtAccounts = ref<Account[] | null>(null)

async function openTxt(): Promise<void> {
  if (preparing.value) return
  preparing.value = true
  try {
    const { list } = await payableTargets()
    if (!list.length) return void message.info('没有还能付款的链接，可以先「重新提取」失效的')
    txtAccounts.value = list
  } finally {
    preparing.value = false
  }
}

async function copyLinks(): Promise<void> {
  if (preparing.value) return
  preparing.value = true
  try {
    const { list, dropped } = await payableTargets()
    if (!list.length) return void message.info('没有还能付款的链接，可以先「重新提取」失效的')
    const skipped = dropped ? `，已跳过失效 / 已付款的 ${dropped} 条` : ''
    copyText(paymentLinkText(list), `已复制 ${list.length} 条支付链接${skipped}`)
  } finally {
    preparing.value = false
  }
}

const exporting = ref(false)

/**
 * payable：只导出还能付款的（发给别人付款用）；否则导出全部记录，导出前同样先确认一遍状态，
 * 表里「付款状态」那一列才是最新的。
 */
async function exportXlsx(payable: boolean): Promise<void> {
  if (!targets.value.length || exporting.value) return
  exporting.value = true
  try {
    let list: Account[]
    if (payable) {
      list = (await payableTargets()).list
      if (!list.length) return void message.info('没有还能付款的链接，可以先「重新提取」失效的')
    } else {
      const unchecked = targets.value.filter(needsStripeCheck)
      if (unchecked.length) await checkPayments(unchecked, true)
      const ids = new Set(targets.value.map((a) => a.id))
      list = marked.value.filter((a) => ids.has(a.id))
    }
    const sheet = buildPaymentLinkSheet(list, accountsStore.groups)
    const res = await window.api.exportToXlsx(toPlain(sheet), paymentLinkFilename())
    if (!res.success) return void message.error(res.error || '导出失败')
    if (res.data?.saved) message.success(`已导出 ${sheet.rows.length} 条支付链接`)
  } finally {
    exporting.value = false
  }
}

function forget(ids: string[]): void {
  const set = new Set(ids)
  selectedKeys.value = selectedKeys.value.filter((id) => !set.has(id))
}

function clearMarks(list: Account[], title: string): void {
  if (!list.length) return
  confirmDanger({
    title,
    content: '只清除账号上的支付链接标记，不影响账号本身与已完成的订阅。清除后这些账号会重新出现在批量提取的候选里。',
    okText: '清除',
    onOk: () => {
      const ids = list.map((a) => a.id)
      const cleared = accountsStore.clearPaymentLinks(ids)
      forget(ids)
      message.success(`已清除 ${cleared} 个账号的支付链接标记`)
    }
  })
}

function clearTargets(): void {
  clearMarks(targets.value, `清除 ${targets.value.length} 个账号的支付链接标记`)
}

/** 已付款的标记留着也没用了，一键清掉，免得记录越堆越多 */
function clearPaid(): void {
  const list = marked.value.filter((a) => paymentLinkState(a, now.value) === 'paid')
  clearMarks(list, `清除 ${list.length} 个已付款账号的标记`)
}

function copyOne(account: Account): void {
  if (account.paymentLink) copyText(account.paymentLink.url, '支付链接已复制')
}

async function openOne(account: Account): Promise<void> {
  if (!account.paymentLink) return
  const res = await window.api.openInAppBrowser(account.paymentLink.url, `支付 - ${account.email}`)
  if (!res.success) message.error(res.error || '打开支付页失败')
}

function clearOne(account: Account): void {
  accountsStore.clearPaymentLinks([account.id])
  forget([account.id])
}
</script>

<template>
  <div class="pane">
    <div class="toolbar">
      <a-radio-group v-model:value="stateFilter" button-style="solid" size="small">
        <a-radio-button v-for="item in filterOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </a-radio-button>
      </a-radio-group>
      <span class="spacer" />
      <span v-if="checking" class="muted small">正在确认付款状态…</span>
      <span v-else-if="lastCheckedAt" class="muted small">付款状态确认于 {{ formatDateTime(lastCheckedAt) }}</span>
      <a-input
        v-model:value="keyword"
        allow-clear
        size="small"
        placeholder="搜索邮箱 / 昵称 / 备注"
        style="width: 200px"
      >
        <template #prefix><SearchOutlined /></template>
      </a-input>
    </div>

    <a-table
      :columns="columns"
      :data-source="visible"
      :row-key="(record: Account) => record.id"
      :row-selection="rowSelection"
      size="small"
      :pagination="{ pageSize: 20, size: 'small', showSizeChanger: false, hideOnSinglePage: true }"
      :scroll="{ y: '42vh' }"
      :locale="{ emptyText: marked.length ? '没有匹配的记录' : '还没有提取过支付链接' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'email'">
          <div class="email-cell">
            <span>{{ displayEmail(record.email, privacy) }}</span>
            <span
              class="url-cell mono muted"
              :title="privacy ? undefined : record.paymentLink.url"
            >{{ displayPaymentUrl(record.paymentLink.url, privacy) }}</span>
          </div>
        </template>
        <template v-else-if="column.key === 'plan'">
          <div>{{ paymentLinkTier(record.paymentLink) }}</div>
          <div class="muted small" :title="`标价 ${formatPrice(record.paymentLink.amount, record.paymentLink.currency)}`">
            {{ amountDueText(record.paymentLink) }}
          </div>
          <div v-if="localDueText(record.paymentLink)" class="small local-due">
            ≈ {{ localDueText(record.paymentLink) }}
          </div>
        </template>
        <template v-else-if="column.key === 'state'">
          <a-tooltip :title="stateMeta(record).tip">
            <a-tag :color="stateMeta(record).color" :bordered="false">{{ stateMeta(record).text }}</a-tag>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'current'">
          <a-tag :color="subscriptionMeta(record.subscription.type).color" :bordered="false">
            {{ subscriptionLabel(record.subscription) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'createdAt'">
          <span class="small">{{ formatDateTime(record.paymentLink.createdAt) }}</span>
        </template>
        <template v-else-if="column.key === 'checkedAt'">
          <a-tooltip :title="uncheckedSinceExtract(record) ? '提取之后还没刷新过订阅状态' : undefined">
            <span class="small" :class="{ warn: uncheckedSinceExtract(record) }">
              {{ record.lastCheckedAt ? formatDateTime(record.lastCheckedAt) : '未刷新' }}
            </span>
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space :size="0">
            <a-tooltip v-if="['pending', 'expired'].includes(paymentLinkState(record, now))" title="重新提取：生成一条新链接">
              <a-button type="text" size="small" :disabled="reExtracting" @click="reExtractOne(record)">
                <template #icon><RedoOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="复制：邮箱 订阅等级 支付链接">
              <a-button type="text" size="small" @click="copyOne(record)">
                <template #icon><CopyOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="在内置浏览器打开">
              <a-button type="text" size="small" @click="openOne(record)">
                <template #icon><ExportOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="清除标记">
              <a-button type="text" size="small" danger @click="clearOne(record)">
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>

    <div class="footer">
      <!-- 主按钮先问 Stripe 再同步 Kiro；下拉里的「刷新 Kiro 订阅档位」用于在别处付过款的情况 -->
      <a-dropdown-button
        type="primary"
        :loading="checking"
        :disabled="!targets.length || reExtracting"
        @click="checkPayments(targets)"
      >
        <SafetyCertificateOutlined />
        检查付款状态{{ scopeSuffix }}
        <template #icon><DownOutlined /></template>
        <template #overlay>
          <a-menu>
            <a-menu-item key="kiro" :disabled="checking" @click="syncKiro">
              刷新 Kiro 订阅档位{{ scopeSuffix }}
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown-button>
      <a-tooltip title="用原来的档位重新生成结算链接；有勾选按勾选，没勾选就是全部已失效的">
        <a-button
          :loading="reExtracting"
          :disabled="!reExtractTargets.length || checking"
          @click="reExtract(reExtractTargets)"
        >
          <template #icon><RedoOutlined /></template>
          重新提取（{{ reExtractTargets.length }}）
        </a-button>
      </a-tooltip>
      <a-tooltip title="一行一个链接。复制前会先向 Stripe 确认，只复制还能付款的；勾选了的按勾选原样复制">
        <a-button :disabled="!targets.length" :loading="preparing" @click="copyLinks">
          <template #icon><CopyOutlined /></template>
          复制可付款链接
        </a-button>
      </a-tooltip>
      <a-dropdown :disabled="!targets.length || exporting || preparing">
        <a-button :disabled="!targets.length" :loading="exporting || preparing">
          <template #icon><FileExcelOutlined /></template>
          导出
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="txt" @click="openTxt">
              <FileTextOutlined />
              代付 TXT（序号 + 链接，可付款的）
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="payable" @click="exportXlsx(true)">Excel：只导出可付款的</a-menu-item>
            <a-menu-item key="all" @click="exportXlsx(false)">Excel：全部记录{{ scopeSuffix }}</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <span class="spacer" />
      <a-dropdown :disabled="!marked.length">
        <a-button danger :disabled="!marked.length">
          <template #icon><ClearOutlined /></template>
          清除标记
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="paid" :disabled="!counts.paid" @click="clearPaid">
              清除已付款（{{ counts.paid }}）
            </a-menu-item>
            <a-menu-item key="targets" :disabled="!targets.length" @click="clearTargets">
              清除{{ selected.length ? '已选' : '当前列表' }}（{{ targets.length }}）
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>

    <PaymentLinkTxtModal
      v-if="txtAccounts"
      :accounts="txtAccounts"
      @close="txtAccounts = null"
    />
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.spacer { flex: 1 1 auto; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.warn { color: #fa8c16; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

.email-cell { display: flex; flex-direction: column; min-width: 0; }
.email-cell > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.url-cell { font-size: 11px; }
.local-due { color: #fa8c16; }
</style>
