<script setup lang="ts">
/**
 * 批量提取 Free 账号的支付链接：选档位、定数量，逐个生成 Stripe 结算链接。
 *
 * - 范围固定为当前档位是 Free 的账号，可再按分组收窄；
 * - 档位列表从接口现拉（与订阅弹窗同源），任取一个凭证可用的账号问一次即可；
 * - 每生成一条链接就去 Stripe 结算页读一次实付金额：新用户优惠只体现在 Checkout Session 上，
 *   Kiro 的档位接口只给标价。不满足优惠条件的链接不保存，账号记一笔「无优惠」，下次默认跳过；
 * - 已提取 / 无优惠 / 凭证失效的账号默认跳过，「数量」在跳过之后的候选里截取前 N 个，
 *   于是提一批、付一批，再点一次就接着往后提；
 * - 低并发 + 错峰：一次提取要开一次门户首页、调一次 CBOR、再问一次 Stripe，批量并发容易被判异常。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  CreditCardOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  MinusCircleFilled,
  StopOutlined,
  SyncOutlined
} from '@ant-design/icons-vue'
import PaymentLinkTxtModal from '@/components/accounts/PaymentLinkTxtModal.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { displayEmail } from '@/utils/display'
import { formatLocal, formatPrice, formatUsd, runPool } from '@/utils/format'
import { UNGROUPED } from '@/utils/groups'
import { auditExport } from '@/utils/audit'
import { toPlain } from '@/utils/ipc'
import { now } from '@/utils/now'
import { confirmDanger, copyText } from '@/utils/ui'
import {
  buildPaymentLinkSheet,
  displayPaymentUrl,
  paymentLinkFilename,
  paymentLinkText
} from '@/utils/paymentLinks'
import {
  discountRuleText,
  estimateFirstPayment,
  extractPaymentLink,
  readDiscountSetting,
  readRate,
  writeDiscountSetting,
  type DiscountRule,
  type DiscountSetting,
  type StoredRate
} from '@/utils/paymentLinkExtract'
import { errorMessage } from '@shared/errors'
import { paymentLinkState, paymentLinkTier } from '@shared/paymentLink'
import { shouldSkipAccountUsageRefresh } from '@shared/refreshPolicy'
import type { Account, SubscriptionPlan } from '@shared/types'

const emit = defineEmits<{ running: [boolean]; 'show-records': [] }>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()

const privacy = computed(() => settingsStore.settings.privacyMode)

// ============ 档位 ============

/** 上次的选择记在本地，下次打开默认还是它 */
const PLAN_STORAGE_KEY = 'kal.paymentLink.plan'

/**
 * 档位列表与账号无关，在会话内缓存 10 分钟：
 * 连着切几次页面不必每次都开门户首页再问一遍。
 */
const PLAN_CACHE_MS = 10 * 60_000
let planCache: { at: number; plans: SubscriptionPlan[] } | null = null

const plans = ref<SubscriptionPlan[]>([])
const plansLoading = ref(false)
const plansError = ref('')
const planType = ref('')

const paidPlans = computed(() => plans.value.filter((plan) => plan.amount > 0))
const plan = computed(() => paidPlans.value.find((p) => p.subscriptionType === planType.value))

/** USD → CNY 汇率；提取时遇到人民币结算页会更新它 */
const rate = ref<StoredRate>(readRate())

interface PlanPrice {
  /** 本批候选里今天应付的最低 / 最高（USD） */
  min: number
  max: number
  minLocal?: string
  maxLocal?: string
  /** 参与估算的账号数（不知道重置日的不算） */
  count: number
}

/**
 * 档位卡片上的优惠后价格：按本批候选账号各自的重置日估算，给出区间。
 * 首期 = 月费 × 剩余天数比例 − $20（见 estimateFirstPayment，已对照实测验证）。
 * 剩余天数越多付得越多，所以同一档位不同账号的价格不一样，区间比单个数字更准确。
 */
const planPrices = computed(() => {
  const nowMs = now.value
  const resets = breakdown.value.candidates
    .slice(0, takeCount.value || undefined)
    .map((a) => a.subscription.expiresAt)
    .filter((t): t is number => !!t && t > nowMs)
  const local = (usd: number): string => formatLocal(usd * rate.value.rate, 'CNY')
  const result = new Map<string, PlanPrice>()
  for (const item of paidPlans.value) {
    const dues = resets
      .map((reset) => estimateFirstPayment(item.amount, reset, nowMs)?.due)
      .filter((d): d is number => d !== undefined)
    if (!dues.length) continue
    const min = Math.min(...dues)
    const max = Math.max(...dues)
    result.set(item.subscriptionType, {
      min,
      max,
      minLocal: local(min),
      maxLocal: local(max),
      count: dues.length
    })
  }
  return result
})

function priceRange(p: PlanPrice): string {
  return p.max - p.min < 0.01 ? formatUsd(p.min) : `${formatUsd(p.min)} ~ ${formatUsd(p.max)}`
}

function localRange(p: PlanPrice): string {
  if (!p.minLocal || !p.maxLocal) return ''
  return p.max - p.min < 0.01 ? p.minLocal : `${p.minLocal} ~ ${p.maxLocal}`
}


function hasValidToken(a: Account): boolean {
  return !!a.credentials.accessToken && (a.credentials.expiresAt ?? 0) - Date.now() > 60_000
}

/** 拉档位用哪些账号：token 还有效的排前面（免一次刷新），跳过封禁 / 凭证失效；最多试 3 个 */
function planProbeIds(): string[] {
  return accountsStore.accounts
    .filter((a) => !shouldSkipAccountUsageRefresh(a))
    .sort((a, b) => Number(hasValidToken(b)) - Number(hasValidToken(a)))
    .slice(0, 3)
    .map((a) => a.id)
}

async function loadPlans(force = false): Promise<void> {
  if (!force && planCache && Date.now() - planCache.at < PLAN_CACHE_MS) {
    applyPlans(planCache.plans)
    return
  }
  plansLoading.value = true
  plansError.value = ''
  try {
    const probes = planProbeIds()
    if (!probes.length) throw new Error('没有凭证可用的账号，无法查询可开通档位')
    let lastError = ''
    for (const id of probes) {
      try {
        const res = await window.api.getSubscriptionPlans(toPlain(await accountsStore.freshAccount(id)))
        if (res.success && res.data?.plans.length) {
          planCache = { at: Date.now(), plans: res.data.plans }
          applyPlans(res.data.plans)
          return
        }
        lastError = res.error || '接口没有返回可开通的订阅档位'
      } catch (e) {
        lastError = errorMessage(e)
      }
    }
    throw new Error(lastError)
  } catch (e) {
    plansError.value = errorMessage(e)
  } finally {
    plansLoading.value = false
  }
}

function applyPlans(list: SubscriptionPlan[]): void {
  plans.value = list
  const saved = readStorage(PLAN_STORAGE_KEY)
  const paid = list.filter((p) => p.amount > 0)
  planType.value = paid.some((p) => p.subscriptionType === saved)
    ? saved
    : paid[0]?.subscriptionType ?? ''
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 不可写就不记，下次回落到默认值 */
  }
}

watch(planType, (value) => value && writeStorage(PLAN_STORAGE_KEY, value))

onMounted(() => {
  void loadPlans()
  void loadMaxLimits()
})

// ============ 优惠条件 ============

const savedSetting = readDiscountSetting()
const discountRule = ref<DiscountRule>(savedSetting.rule)
const maxAmount = ref<number | null>(savedSetting.max)
const setting = computed<DiscountSetting>(() => ({ rule: discountRule.value, max: maxAmount.value }))

watch(setting, (value) => writeDiscountSetting(value))

const ruleText = computed(() => discountRuleText(setting.value))

// ============ 范围与数量 ============

/** 分组筛选，空数组不限；UNGROUPED 代表未分组 */
const groupIds = ref<string[]>([])
/** 导入时间顺序：新号一般最后导入，默认从新到旧 */
const order = ref<'newest' | 'oldest'>('newest')
const skipExtracted = ref(true)
/** 跳过已提取时，链接已失效的照样重新提取：失效链接留着没用，不算「已提取」 */
const reExtractExpired = ref(true)
const skipNoDiscount = ref(true)
const skipAbnormal = ref(true)
/**
 * 跳过曾经订阅过的：现在是 Free、但额度历史上出现过 > 50（付费档）的账号。
 * 它们是订阅到期掉回 Free 的老号，$20 新用户余额已经用掉，提出来的链接都是原价。
 */
const skipLapsed = ref(true)
/** 免费档的额度上限；历史上限超过它说明付费过 */
const FREE_LIMIT = 50
/** 各账号历史最高额度上限，进页面时从主进程取一次 */
const maxLimits = ref<Record<string, number>>({})

function isLapsed(account: Account): boolean {
  return (maxLimits.value[account.id] ?? account.usage.limit ?? 0) > FREE_LIMIT
}

async function loadMaxLimits(): Promise<void> {
  try {
    const res = await window.api.getMaxUsageLimits()
    if (res.success && res.data) maxLimits.value = res.data
  } catch {
    /* 取不到就只按当前额度判断 */
  }
}
/** 提取数量；null 表示「全部候选」 */
const quantity = ref<number | null>(null)

/** 并发上限 20：每条要过 Kiro 门户 + CBOR + Stripe 三个请求，再高容易被限流 */
const MAX_CONCURRENCY = 20
const CONCURRENCY_STORAGE_KEY = 'kal.paymentLink.concurrency'
const concurrency = ref(
  Math.min(MAX_CONCURRENCY, Math.max(1, Number(readStorage(CONCURRENCY_STORAGE_KEY)) || 3))
)
watch(concurrency, (value) => value && writeStorage(CONCURRENCY_STORAGE_KEY, String(value)))

const groupOptions = computed(() => [
  { value: UNGROUPED, label: '未分组' },
  ...accountsStore.groups.map((g) => ({ value: g.id, label: g.name }))
])

/** 范围：当前档位是 Free 的账号，按分组收窄，按导入时间排序 */
const scopeAccounts = computed(() => {
  const groupSet = groupIds.value.length ? new Set(groupIds.value) : null
  const list = accountsStore.accounts.filter((a) => {
    if (a.subscription.type !== 'Free') return false
    if (!groupSet) return true
    const gid = a.groupId && accountsStore.groupMap.has(a.groupId) ? a.groupId : UNGROUPED
    return groupSet.has(gid)
  })
  const sign = order.value === 'newest' ? -1 : 1
  return list.sort((a, b) => sign * ((a.createdAt || 0) - (b.createdAt || 0)))
})

/** 范围内各类账号的数量，同时给出跳过之后的候选列表 */
const breakdown = computed(() => {
  let extracted = 0
  let expired = 0
  let noDiscount = 0
  let abnormal = 0
  let lapsed = 0
  const nowMs = now.value
  const candidates: Account[] = []
  for (const account of scopeAccounts.value) {
    const state = paymentLinkState(account, nowMs)
    const isExtracted = state !== 'none'
    const isExpired = state === 'expired'
    const isNoDiscount = !!account.discountCheck
    const isAbnormal = shouldSkipAccountUsageRefresh(account)
    const isLapsedAccount = isLapsed(account)
    if (isExtracted) extracted++
    if (isExpired) expired++
    if (isNoDiscount) noDiscount++
    if (isAbnormal) abnormal++
    if (isLapsedAccount) lapsed++
    if (skipExtracted.value && isExtracted && !(reExtractExpired.value && isExpired)) continue
    if (skipNoDiscount.value && isNoDiscount) continue
    if (skipAbnormal.value && isAbnormal) continue
    if (skipLapsed.value && isLapsedAccount) continue
    candidates.push(account)
  }
  return { extracted, expired, noDiscount, abnormal, lapsed, candidates }
})

const takeCount = computed(() => {
  const total = breakdown.value.candidates.length
  if (quantity.value == null) return total
  return Math.max(0, Math.min(total, Math.floor(quantity.value)))
})

function clearNoDiscount(): void {
  const ids = scopeAccounts.value.filter((a) => a.discountCheck).map((a) => a.id)
  if (!ids.length) return
  confirmDanger({
    title: `清除 ${ids.length} 个账号的「无优惠」记录`,
    content: '清除后这些账号会重新进入候选，下次提取时会再为它们生成链接并查一次实付金额。',
    okText: '清除',
    onOk: () => {
      message.success(`已清除 ${accountsStore.clearDiscountChecks(ids)} 条记录`)
    }
  })
}

// ============ 执行 ============

type RowState = 'pending' | 'running' | 'ok' | 'skip' | 'fail'
interface Row {
  id: string
  email: string
  state: RowState
  url?: string
  /** 实付金额文案，成功与「无优惠」都显示 */
  priceText?: string
  error?: string
}

const rows = ref<Row[]>([])
const running = ref(false)
const aborted = ref(false)
const listRef = ref<HTMLElement | null>(null)
/** 本次运行用的档位，运行中途切换选择不影响已在跑的这一批 */
const runPlan = ref<SubscriptionPlan | null>(null)

watch(running, (value) => emit('running', value))

const stat = computed(() => {
  const count = { ok: 0, skip: 0, fail: 0, pending: 0 }
  for (const row of rows.value) {
    if (row.state === 'ok') count.ok++
    else if (row.state === 'skip') count.skip++
    else if (row.state === 'fail') count.fail++
    else count.pending++
  }
  return count
})

/** 本批成功提取到的账号，取 store 里的最新数据，用于复制 / 导出 */
const extractedAccounts = computed(() =>
  rows.value
    .filter((row) => row.state === 'ok')
    .map((row) => accountsStore.get(row.id))
    .filter((a): a is Account => !!a?.paymentLink)
)

function email(value: string): string {
  return displayEmail(value, privacy.value)
}

function revealRow(index: number): void {
  const target = listRef.value?.querySelector<HTMLElement>(
    `[data-row-index="${Math.min(index + 2, rows.value.length - 1)}"]`
  )
  target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

async function extractOne(row: Row, target: SubscriptionPlan, rule: DiscountSetting, index: number): Promise<void> {
  row.state = 'running'
  row.error = undefined
  row.priceText = undefined
  await nextTick()
  revealRow(index)
  const result = await extractPaymentLink(row.id, target, rule)
  row.state = result.state
  row.url = result.url
  row.priceText = result.priceText
  row.error = result.error
}

async function run(list: Row[]): Promise<void> {
  const target = runPlan.value
  if (!target || !list.length) return
  // 本轮的优惠条件同样在开跑时定下，中途改选择不影响已在跑的这一批
  const rule = { ...setting.value }
  running.value = true
  aborted.value = false
  const before = { ...stat.value }
  try {
    await runPool(
      list,
      concurrency.value,
      async (row) => {
        // 中止后排队中的行保持「等待」，可以点「继续提取」接着跑
        if (aborted.value) return
        await extractOne(row, target, rule, rows.value.indexOf(row))
      },
      { staggerMs: 600 }
    )
  } finally {
    running.value = false
    // 提取时读到的汇率已写进本地，档位卡片的人民币估算跟着更新
    rate.value = readRate()
  }
  // 只报这一轮的增量：重试 / 继续时之前成功的不重复计数
  const ok = stat.value.ok - before.ok
  const skip = stat.value.skip - before.skip
  const fail = stat.value.fail
  const detail = `成功 ${ok}${skip ? `，跳过 ${skip}` : ''}${fail ? `，失败 ${fail}` : ''}`
  if (aborted.value) message.info(`已中止：${detail}`)
  else if (fail) message.warning(`提取完成：${detail}`)
  else message.success(`提取完成：${detail}`)
}

function start(): void {
  if (running.value) return
  if (!plan.value) return void message.warning('请先选择订阅档位')
  if (discountRule.value === 'max' && maxAmount.value == null) {
    return void message.warning('请填写实付金额上限')
  }
  const picked = breakdown.value.candidates.slice(0, takeCount.value)
  if (!picked.length) return void message.info('没有符合条件的账号')
  runPlan.value = plan.value
  rows.value = picked.map((account) => ({ id: account.id, email: account.email, state: 'pending' }))
  void run(rows.value)
}

/** 重试失败项，或在中止后继续跑剩下的等待项 */
function resume(): void {
  if (running.value) return
  void run(rows.value.filter((row) => row.state === 'fail' || row.state === 'pending'))
}

function abort(): void {
  aborted.value = true
}

/** 回到设置：已提取 / 无优惠的账号默认会被跳过，于是「下一批」自然从后面接着提 */
function backToSetup(): void {
  if (running.value) return
  rows.value = []
  runPlan.value = null
}

defineExpose({ abort })

function copyRow(row: Row): void {
  const account = accountsStore.get(row.id)
  if (account?.paymentLink) copyText(account.paymentLink.url, '支付链接已复制')
}

async function openRow(row: Row): Promise<void> {
  if (!row.url) return
  const res = await window.api.openInAppBrowser(row.url, `支付 - ${row.email}`)
  if (!res.success) message.error(res.error || '打开支付页失败')
}

function copyAll(): void {
  const list = extractedAccounts.value
  if (!list.length) return
  copyText(paymentLinkText(list), `已复制 ${list.length} 条支付链接`)
}

const exporting = ref(false)
/** 代付 TXT 弹窗：导出本批刚提取出来的那些 */
const txtOpen = ref(false)

async function exportXlsx(): Promise<void> {
  const list = extractedAccounts.value
  if (!list.length || exporting.value) return
  exporting.value = true
  try {
    const sheet = buildPaymentLinkSheet(list, accountsStore.groups)
    const res = await window.api.exportToXlsx(toPlain(sheet), paymentLinkFilename())
    if (!res.success) return void message.error(res.error || '导出失败')
    if (res.data?.saved) {
      auditExport(`导出支付链接 Excel → ${res.data.path ?? ""}`, list.map((a) => a.email))
      message.success(`已导出 ${sheet.rows.length} 条支付链接`)
    }
  } finally {
    exporting.value = false
  }
}

function tierOf(row: Row): string {
  const link = accountsStore.get(row.id)?.paymentLink
  return link ? paymentLinkTier(link) : ''
}
</script>

<template>
  <div class="pane">
    <!-- ============ 设置阶段 ============ -->
    <template v-if="!rows.length">
      <!-- 与主页 / 关于页同款的小卡片：标题在卡片头，右侧放这一块的动作 -->
      <a-card size="small" title="订阅档位">
        <template #extra>
          <a-button
            type="link"
            size="small"
            :loading="plansLoading"
            :disabled="plansLoading"
            @click="loadPlans(true)"
          >
            <template #icon><SyncOutlined /></template>
            重新获取
          </a-button>
        </template>

        <div v-if="plansLoading && !plans.length" class="plans-stage">
          <a-spin />
          <span class="muted">正在查询可开通的订阅档位…</span>
        </div>
        <a-alert
          v-else-if="plansError"
          type="error"
          show-icon
          :message="`查询订阅档位失败：${plansError}`"
        >
          <template #action>
            <a-button size="small" @click="loadPlans(true)">重试</a-button>
          </template>
        </a-alert>
        <div v-else class="plan-options" role="radiogroup" aria-label="订阅档位">
          <button
            v-for="item in paidPlans"
            :key="item.subscriptionType"
            type="button"
            role="radio"
            :aria-checked="planType === item.subscriptionType"
            class="plan-option"
            :class="{ selected: planType === item.subscriptionType }"
            @click="planType = item.subscriptionType"
          >
            <span class="plan-name">{{ item.title }}</span>
            <template v-if="planPrices.get(item.subscriptionType)">
              <span class="plan-due">
                <strong>{{ priceRange(planPrices.get(item.subscriptionType)!) }}</strong>
              </span>
              <span v-if="localRange(planPrices.get(item.subscriptionType)!)" class="plan-local">
                ≈ {{ localRange(planPrices.get(item.subscriptionType)!) }}
              </span>
              <span class="plan-meta muted">
                今天应付 · 原价 <s>{{ formatPrice(item.amount, item.currency) }}/月</s>
              </span>
            </template>
            <span v-else class="plan-meta muted">
              原价 {{ formatPrice(item.amount, item.currency) }}/月 · 候选账号没有重置日，无法估算
            </span>
          </button>
        </div>
        <div class="hint muted">
          今天应付 = 月费 × 到重置日的剩余天数比例 − $20 新用户余额，按本批候选账号各自的重置日估算，
          提取时以 Stripe 实际金额为准。之后每月按原价续费。
        </div>
      </a-card>

      <!-- 提取设置：三项统一成「左标签 + 右内容」的表单网格，标签宽度一致，控件上下对齐 -->
      <a-card size="small" title="提取设置">
      <div class="form-grid">
        <span class="form-label">优惠条件</span>
        <div class="form-field">
          <a-radio-group v-model:value="discountRule" class="rule-group">
            <a-radio value="any">有新用户抵扣（$20 余额）</a-radio>
            <a-tooltip title="首期按到账号重置日的剩余天数折算，剩余天数越多今天要付的越多，所以同是新号金额也会不同">
              <a-radio value="max">
                有抵扣且今天应付 ≤
                <a-input-number
                  v-model:value="maxAmount"
                  :min="0"
                  :precision="2"
                  :disabled="discountRule !== 'max'"
                  size="small"
                  addon-before="$"
                  class="inline-number"
                  @click.stop
                />
              </a-radio>
            </a-tooltip>
            <a-radio value="off">不校验金额</a-radio>
          </a-radio-group>
        </div>

        <span class="form-label">提取范围</span>
        <div class="form-field">
          <div class="scope-row">
            <a-tag :bordered="false" class="scope-tag">Free 账号 {{ scopeAccounts.length }} 个</a-tag>
            <a-select
              v-model:value="groupIds"
              mode="multiple"
              allow-clear
              :options="groupOptions"
              placeholder="全部分组"
              :max-tag-count="2"
              class="group-select"
            />
            <a-select
              v-model:value="order"
              :options="[
                { value: 'newest', label: '导入时间 新 → 旧' },
                { value: 'oldest', label: '导入时间 旧 → 新' }
              ]"
              class="order-select"
            />
          </div>
          <div class="checks">
          <a-checkbox v-model:checked="skipExtracted">
            跳过已提取过的<span class="muted">（{{ breakdown.extracted }}）</span>
          </a-checkbox>
          <a-tooltip title="Stripe 结算链接一般 24 小时失效。已失效、又没付款的账号不算「已提取」，照样重新生成一条新链接">
            <a-checkbox v-model:checked="reExtractExpired" :disabled="!skipExtracted">
              但重新提取链接已失效的<span class="muted">（{{ breakdown.expired }}）</span>
            </a-checkbox>
          </a-tooltip>
          <a-checkbox v-model:checked="skipNoDiscount">
            跳过已确认无优惠的<span class="muted">（{{ breakdown.noDiscount }}）</span>
          </a-checkbox>
          <a-checkbox v-model:checked="skipAbnormal">
            跳过封禁 / 凭证失效的<span class="muted">（{{ breakdown.abnormal }}）</span>
          </a-checkbox>
          <a-tooltip title="现在是 Free、但额度历史上出现过付费档（> 50）的账号：订阅到期掉回 Free 的老号，$20 新用户余额已经用掉，只能原价开通">
            <a-checkbox v-model:checked="skipLapsed">
              跳过曾经订阅过的<span class="muted">（{{ breakdown.lapsed }}）</span>
            </a-checkbox>
          </a-tooltip>
            <a-button
              v-if="breakdown.noDiscount"
              type="link"
              size="small"
              class="link-btn"
              @click="clearNoDiscount"
            >
              清除无优惠记录
            </a-button>
          </div>
        </div>

        <span class="form-label">数量</span>
        <div class="form-field">
          <div class="quantity-row">
            <a-input-number
              v-model:value="quantity"
              :min="1"
              :max="Math.max(1, breakdown.candidates.length)"
              :precision="0"
              placeholder="全部"
              class="qty-input"
            />
            <span class="muted">
              符合条件 {{ breakdown.candidates.length }} 个，本次提取 <strong class="em">{{ takeCount }}</strong> 个
            </span>
            <span class="spacer" />
            <a-tooltip title="同时提取的账号数，最多 20。每个账号要过 Kiro 门户与 Stripe 三个请求，太高容易被限流">
              <span class="concurrency">
                <span class="muted">并发</span>
                <a-input-number
                  v-model:value="concurrency"
                  :min="1"
                  :max="MAX_CONCURRENCY"
                  :precision="0"
                  class="concurrency-input"
                />
              </span>
            </a-tooltip>
          </div>
        </div>
      </div>
      </a-card>

      <div class="footer setup-footer">
        <span class="muted small footer-note">
          满足条件的保存为「待付款」，不满足的记为「无优惠」下次跳过。链接最长 24 小时失效，同一账号重新生成后旧链接立即失效，失效的可以再提取。
        </span>
        <a-button @click="emit('show-records')">查看提取记录</a-button>
        <a-button type="primary" :disabled="!plan || !takeCount || plansLoading" @click="start">
          <template #icon><CreditCardOutlined /></template>
          开始提取（{{ takeCount }} 个）
        </a-button>
      </div>
    </template>

    <!-- ============ 运行 / 结果阶段 ============ -->
    <template v-else>
      <a-card size="small" :title="`提取进度 · ${runPlan?.title ?? ''}`">
      <div class="summary">
        <span class="muted">共 {{ rows.length }} 个 · {{ ruleText }}</span>
        <a-tag v-if="stat.ok" color="green" :bordered="false">成功 {{ stat.ok }}</a-tag>
        <a-tag v-if="stat.skip" :bordered="false">跳过 {{ stat.skip }}</a-tag>
        <a-tag v-if="stat.fail" color="red" :bordered="false">失败 {{ stat.fail }}</a-tag>
        <a-tag v-if="stat.pending" :bordered="false">等待 {{ stat.pending }}</a-tag>
        <span class="spacer" />
        <span v-if="running" class="muted">
          正在提取 {{ stat.ok + stat.skip + stat.fail }}/{{ rows.length }}
        </span>
      </div>

      <a-progress
        :percent="Math.round(((stat.ok + stat.skip + stat.fail) / rows.length) * 100)"
        :status="running ? 'active' : stat.fail ? 'exception' : 'success'"
        size="small"
        style="margin: 8px 0 12px"
      />
      <div ref="listRef" class="row-list">
        <div
          v-for="(row, index) in rows"
          :key="row.id"
          :data-row-index="index"
          class="row"
          :class="row.state"
        >
          <div class="row-main">
            <div class="row-email">
              {{ email(row.email) }}
              <a-tag v-if="row.state === 'ok'" color="purple" :bordered="false" class="tier-tag">
                {{ tierOf(row) }}
              </a-tag>
              <span v-if="row.priceText" class="price-text">{{ row.priceText }}</span>
            </div>
            <div v-if="row.url" class="row-url mono" :title="privacy ? undefined : row.url">
              {{ displayPaymentUrl(row.url, privacy) }}
            </div>
          </div>
          <div class="row-state">
            <template v-if="row.state === 'pending'">
              <span class="muted">等待提取</span>
            </template>
            <template v-else-if="row.state === 'running'">
              <a-spin size="small" />
              <span class="running-text">提取中</span>
            </template>
            <template v-else-if="row.state === 'ok'">
              <CheckCircleFilled class="ok-icon" />
              <span class="ok-text">已提取</span>
              <a-tooltip title="复制支付链接">
                <a-button type="text" size="small" @click="copyRow(row)">
                  <template #icon><CopyOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-tooltip title="在内置浏览器打开">
                <a-button type="text" size="small" @click="openRow(row)">
                  <template #icon><ExportOutlined /></template>
                </a-button>
              </a-tooltip>
            </template>
            <template v-else-if="row.state === 'skip'">
              <MinusCircleFilled class="skip-icon" />
              <span class="skip-text" :title="row.error">{{ row.error }}</span>
            </template>
            <template v-else>
              <CloseCircleFilled class="fail-icon" />
              <span class="fail-text" :title="row.error">{{ row.error }}</span>
            </template>
          </div>
        </div>
      </div>
      </a-card>

      <div class="footer">
        <a-tooltip title="一行一个链接">
          <a-button :disabled="!extractedAccounts.length || running" @click="copyAll">
            <template #icon><CopyOutlined /></template>
            复制链接（{{ extractedAccounts.length }}）
          </a-button>
        </a-tooltip>
        <a-dropdown :disabled="!extractedAccounts.length || running">
          <a-button :disabled="!extractedAccounts.length || running" :loading="exporting">
            <template #icon><FileExcelOutlined /></template>
            导出（{{ extractedAccounts.length }}）
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="txt" @click="txtOpen = true">
                <FileTextOutlined />
                代付 TXT（序号 + 链接）
              </a-menu-item>
              <a-menu-item key="xlsx" @click="exportXlsx">
                <FileExcelOutlined />
                Excel（含邮箱、金额、状态）
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <span class="spacer" />
        <a-button v-if="running" danger @click="abort">
          <template #icon><StopOutlined /></template>
          中止
        </a-button>
        <template v-else>
          <a-button @click="backToSetup">提取下一批</a-button>
          <a-button v-if="stat.fail || stat.pending" type="primary" @click="resume">
            {{ stat.pending ? '继续提取' : '重试失败项' }}
          </a-button>
        </template>
      </div>
    </template>

    <PaymentLinkTxtModal
      v-if="txtOpen"
      :accounts="extractedAccounts"
      @close="txtOpen = false"
    />
  </div>
</template>

<style scoped>
/* 与主页、关于页一致：块与块之间 16px，每块是独立的小卡片 */
.pane { display: flex; flex-direction: column; gap: 16px; }
.section { display: flex; flex-direction: column; gap: 10px; }
.section-head { display: flex; align-items: center; gap: 8px; }
.section-title { font-weight: 600; }
.spacer { flex: 1 1 auto; }
.muted { color: var(--kal-muted); }
.small { font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

.plans-stage { display: flex; align-items: center; gap: 10px; padding: 16px 0; }

/* 档位卡片：四档一排铺满，名称 / 优惠后价格 / 标价三行 */
.plan-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.plan-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  border-radius: 12px;
  border: 2px solid var(--kal-border);
  background: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.plan-option:hover { border-color: var(--kal-primary); }
.plan-option.selected {
  border-color: var(--kal-primary);
  background: color-mix(in srgb, var(--kal-primary) 8%, transparent);
}
.plan-option.selected .plan-name { color: var(--kal-primary); }
.plan-name { font-weight: 600; font-size: 13px; }
.plan-due { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.plan-due strong { font-size: 20px; line-height: 1.2; }
.plan-local { font-size: 13px; color: #fa8c16; font-weight: 600; }
.plan-meta { font-size: 12px; }
.hint { font-size: 12px; line-height: 1.6; }

/* 表单网格：左边标签列固定宽度，右边内容列；每行之间同样的间距 */
.form-grid {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: start;
  gap: 14px 12px;
}
.form-label { font-weight: 600; line-height: 32px; }
.form-field { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

.rule-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; min-height: 32px; }
.rule-group :deep(.ant-radio-wrapper) { margin-inline-end: 0; align-items: center; }
.inline-number { width: 110px; margin-left: 4px; }

.scope-row, .quantity-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.scope-tag { margin: 0; line-height: 30px; padding: 0 10px; }
.group-select { flex: 1 1 240px; min-width: 200px; }
.order-select { width: 170px; }
.checks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px; }
.checks :deep(.ant-checkbox-wrapper) { margin-inline-start: 0; }
.link-btn { padding: 0; height: auto; }
.qty-input { width: 120px; }
.em { color: var(--kal-primary); }
.concurrency { display: inline-flex; align-items: center; gap: 8px; }
.concurrency-input { width: 72px; }

.setup-footer { gap: 10px; }
.footer-note { flex: 1 1 auto; min-width: 0; line-height: 1.6; }

.summary { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }

.row-list { max-height: 52vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--kal-block-bg);
  border: 1px solid transparent;
  transition: border-color 0.2s;
}
.row.running { border-color: var(--kal-primary); }
.row.ok { border-color: #52c41a33; }
.row.fail { border-color: #ff4d4f33; }

.row-main { min-width: 0; flex: 1 1 auto; }
.row-email {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
}
.tier-tag { margin: 0; }
.price-text { color: var(--kal-muted); font-size: 12px; }
.row-url {
  margin-top: 2px;
  color: var(--kal-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-state { flex: 0 0 auto; max-width: 50%; display: flex; align-items: center; gap: 6px; font-size: 12px; }
.running-text { color: var(--kal-primary); }
.ok-icon, .ok-text { color: #52c41a; }
.skip-icon { color: var(--kal-muted); flex: 0 0 auto; }
.skip-text { color: var(--kal-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fail-icon { color: #ff4d4f; flex: 0 0 auto; }
.fail-text { color: #ff4d4f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.footer { display: flex; align-items: center; gap: 8px; }
</style>
