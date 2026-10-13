// 单个账号提取支付链接：批量提取与「重新提取」共用同一套流程与优惠判定
import { useAccountsStore } from '@/stores/accounts'
import { errorMessage } from '@shared/errors'
import type { AccountPaymentLink, CheckoutPrice, SubscriptionPlan } from '@shared/types'
import { formatLocal, formatUsd, subscriptionLabel } from './format'
import { toPlain } from './ipc'

/**
 * any：结算页有余额抵扣就算新用户（新号自带 $20 Stripe 余额）；
 * max：在有抵扣的基础上，今天应付还要不超过给定金额；
 * off：不校验金额。
 *
 * 不能拿「实付 < 标价」判断：首期按到重置日的剩余天数折算，没有优惠的老号实付也会低于标价。
 */
export type DiscountRule = 'any' | 'max' | 'off'

export interface DiscountSetting {
  rule: DiscountRule
  /** rule 为 max 时的上限（USD） */
  max: number | null
}

const RULE_STORAGE_KEY = 'kal.paymentLink.rule'

/** 上次用的优惠条件；重新提取沿用它，和批量提取面板上的选择保持一致 */
export function readDiscountSetting(): DiscountSetting {
  try {
    const saved = JSON.parse(localStorage.getItem(RULE_STORAGE_KEY) || '{}') as Partial<DiscountSetting>
    const rule = saved.rule === 'max' || saved.rule === 'off' ? saved.rule : 'any'
    return { rule, max: typeof saved.max === 'number' ? saved.max : 5 }
  } catch {
    return { rule: 'any', max: 5 }
  }
}

export function writeDiscountSetting(setting: DiscountSetting): void {
  try {
    localStorage.setItem(RULE_STORAGE_KEY, JSON.stringify(setting))
  } catch {
    /* 不可写就不记，下次回落到默认值 */
  }
}

export function discountRuleText(setting: DiscountSetting): string {
  if (setting.rule === 'off') return '不校验金额，全部保留'
  if (setting.rule === 'max') return `只保留有新用户抵扣、且今天应付 ≤ $${setting.max ?? 0} 的`
  return '只保留有新用户余额抵扣的'
}

/** 按规则判断这条链接要不要；返回 null 表示满足 */
export function rejectReason(price: CheckoutPrice | undefined, setting: DiscountSetting): string | null {
  if (setting.rule === 'off') return null
  if (!price) return '没读到实付金额'
  if (price.credit <= 0) return `无新用户抵扣（今付 ${formatUsd(price.amountDue)}）`
  if (setting.rule === 'max') {
    const limit = setting.max ?? 0
    if (price.amountDue > limit + 1e-6) return `今付 ${formatUsd(price.amountDue)}，高于 $${limit}`
  }
  return null
}

export function priceLabel(price: CheckoutPrice): string {
  const credit = price.credit > 0 ? ` − 抵扣 ${formatUsd(price.credit)}` : ''
  // 结算页展示币种随出口 IP 变（CNY / USD / UZS…），这里统一折成人民币
  const cny = linkCny({
    amountDue: price.amountDue,
    localDue: price.presentmentDue,
    localCurrency: price.presentmentCurrency
  })
  const local = cny !== undefined ? ` ≈ ${formatLocal(cny, 'CNY')}` : ''
  return `今付 ${formatUsd(price.amountDue)}${local}（首期 ${formatUsd(price.subtotal)}${credit}）`
}

/** 保存进 paymentLink 的金额字段；顺带记下最新汇率，档位卡片估算人民币价格要用 */
export function priceFields(price: CheckoutPrice | undefined): Partial<AccountPaymentLink> {
  if (!price) return {}
  rememberRate(price.presentmentCurrency, price.presentmentRate)
  return {
    amountDue: price.amountDue,
    credit: price.credit,
    subtotal: price.subtotal,
    localDue: price.presentmentDue,
    localCurrency: price.presentmentCurrency,
    localRate: price.presentmentRate
  }
}

// ============ 首期估算 ============

/** 新用户余额，从首期里抵扣 */
export const NEW_USER_CREDIT = 20

/** 同一时刻往前推一个自然月（Stripe 按月计费的上一个周期起点） */
function previousMonth(ms: number): number {
  const d = new Date(ms)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime()
}

/**
 * 估算某账号开通某档位时的首期与今天应付（USD）。
 *
 * Stripe 以账号的重置日为计费锚点，首期 = 月费 × 剩余时长 / 本周期总时长，再扣 $20 新用户余额。
 * 实测（重置日 11-01、10-12 16:50 UTC 提取，剩 19.3/31 天 ≈ 0.623）：
 * Pro 12.46、Pro+ 24.93、Pro Max 62.32、Power 124.64，四档比例一致，按此公式误差在 1 美分内。
 * 不知道重置日时返回 undefined，界面不硬估。
 */
export function estimateFirstPayment(
  amount: number,
  resetAt: number | undefined,
  nowMs = Date.now()
): { subtotal: number; due: number } | undefined {
  if (!resetAt || resetAt <= nowMs) return undefined
  const start = previousMonth(resetAt)
  const ratio = Math.min(1, (resetAt - nowMs) / (resetAt - start))
  const subtotal = Math.round(amount * ratio * 100) / 100
  return { subtotal, due: Math.max(0, Math.round((subtotal - NEW_USER_CREDIT) * 100) / 100) }
}

/** 价格优化门槛：链接放了这么久、且现在重新生成能便宜这么多，才算值得换 */
export const OPTIMIZE_MIN_AGE_MS = 30 * 60_000
export const OPTIMIZE_MIN_SAVING_USD = 0.3

/**
 * 现在重新生成这条链接能便宜多少（USD）；不值得换时返回 0。
 *
 * 链接的金额在生成那一刻就定了（首期 = 月费 × 到重置日的剩余天数比例 − $20），
 * 之后剩余天数一天天变少，同一个号重新生成会越来越便宜。放了一段时间的待付款链接，
 * 用最新的剩余天数估一下，便宜够多就值得换新。
 */
export function optimizableSaving(
  link: Pick<AccountPaymentLink, 'amount' | 'amountDue' | 'createdAt'>,
  resetAt: number | undefined,
  nowMs = Date.now(),
  currentDue?: number
): number {
  const due = currentDue ?? link.amountDue
  if (due === undefined || nowMs - link.createdAt < OPTIMIZE_MIN_AGE_MS) return 0
  const estimate = estimateFirstPayment(link.amount, resetAt, nowMs)
  if (!estimate) return 0
  const saving = Math.round((due - estimate.due) * 100) / 100
  return saving >= OPTIMIZE_MIN_SAVING_USD ? saving : 0
}

// ============ 汇率 ============

/**
 * 美元 → 人民币的汇率（1 USD = rate CNY），界面上所有「≈ ¥」都用它。
 *
 * Stripe 按请求出口 IP 决定展示币种：同一批链接，走国内 IP 是 CNY，走代理可能是 USD、UZS……
 * 所以不能直接显示结算页的本地金额。只在结算页恰好是 CNY 时记下它的汇率（含 Stripe 的换汇加价），
 * 其余情况用记下的值；一次都没见过时用实测过的 6.96 兜底。
 */
const RATE_STORAGE_KEY = 'kal.paymentLink.cnyRate'
/** 2026-10 实测 Stripe Adaptive Pricing 的 USD→CNY 汇率 */
const FALLBACK_CNY_RATE = 6.96

export interface StoredRate {
  currency: 'CNY'
  rate: number
  /** 记下的时间；0 表示还没见过，用的是兜底值 */
  at: number
}

function rememberRate(currency: string, rate: number): void {
  if (currency !== 'CNY' || !(rate > 0)) return
  try {
    localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify({ currency, rate, at: Date.now() }))
  } catch {
    /* 不可写就不记 */
  }
}

export function readRate(): StoredRate {
  try {
    const saved = JSON.parse(localStorage.getItem(RATE_STORAGE_KEY) || 'null') as StoredRate | null
    if (saved && saved.currency === 'CNY' && saved.rate > 0) return saved
  } catch {
    /* 读不到用兜底 */
  }
  return { currency: 'CNY', rate: FALLBACK_CNY_RATE, at: 0 }
}

/** 某条链接今天应付的人民币：结算页本来就是 CNY 用它的原值，否则按汇率从美元换算 */
export function linkCny(link: Pick<AccountPaymentLink, 'amountDue' | 'localDue' | 'localCurrency'>): number | undefined {
  if (link.localCurrency === 'CNY' && link.localDue !== undefined) return link.localDue
  if (link.amountDue === undefined) return undefined
  return Math.round(link.amountDue * readRate().rate * 100) / 100
}

/** 下单所需的档位信息；重新提取时由已存的链接还原，不必再查一次档位列表 */
export type PlanTarget = Pick<SubscriptionPlan, 'subscriptionType' | 'title' | 'amount' | 'currency'>

export interface ExtractResult {
  state: 'ok' | 'skip' | 'fail'
  url?: string
  priceText?: string
  error?: string
}

/**
 * 为一个账号生成结算链接、读实付金额、按规则决定保存还是丢弃。
 * 结果直接写回 store：满足条件记 paymentLink，读到金额但不满足记 discountCheck。
 */
export async function extractPaymentLink(
  id: string,
  target: PlanTarget,
  setting: DiscountSetting
): Promise<ExtractResult> {
  const accountsStore = useAccountsStore()
  try {
    const account = await accountsStore.freshAccount(id)
    const res = await window.api.createSubscriptionCheckout(toPlain(account), target.subscriptionType, {
      probePrice: setting.rule !== 'off'
    })
    if (!res.success || !res.data) throw new Error(res.error || '生成支付链接失败')
    const { url, kind, price, priceError } = res.data
    if (kind === 'manage') {
      // 档位数据滞后时会遇到：账号其实已订阅，接口只给账单管理链接，不记标记
      return {
        state: 'skip',
        error: `已有订阅（${subscriptionLabel(account.subscription)}），接口只返回账单管理链接`
      }
    }
    const priceText = price ? priceLabel(price) : undefined

    const reason = rejectReason(price, setting)
    if (reason) {
      // 读到了金额却不满足条件才记「无优惠」；没读到属于临时故障，留着下次重试
      if (!price) return { state: 'fail', priceText, error: `${reason}：${priceError || '未知原因'}` }
      accountsStore.setDiscountCheck(id, {
        subscriptionType: target.subscriptionType,
        planTitle: target.title,
        amountDue: price.amountDue,
        credit: price.credit,
        checkedAt: Date.now()
      })
      return { state: 'skip', priceText, error: reason }
    }

    accountsStore.setPaymentLink(id, {
      url,
      subscriptionType: target.subscriptionType,
      planTitle: target.title,
      amount: target.amount,
      currency: target.currency,
      ...priceFields(price),
      // 刚生成的会话一定是 open，记上免得马上又去问一遍
      stripeStatus: 'open',
      stripeCheckedAt: Date.now(),
      createdAt: Date.now()
    })
    return { state: 'ok', url, priceText }
  } catch (e) {
    const message = errorMessage(e)
    /*
     * 实测（2026-10）：Google / GitHub 登录、当前 Free 的账号调订阅接口一律 401，
     * 刷新 token 也一样；同类型已订阅的账号却正常。这批号恰好全是订阅过又到期的老号，
     * 没有新用户优惠，算跳过而不是失败，免得被当成临时故障反复重试。
     */
    if (/401/.test(message) && /Unauthorized/i.test(message)) {
      return { state: 'skip', error: 'Kiro 网页端拒绝该账号生成订阅链接（社交登录的老号常见）' }
    }
    return { state: 'fail', error: message }
  }
}
