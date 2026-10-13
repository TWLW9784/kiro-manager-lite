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
  const local = price.presentmentCurrency !== 'USD' ? ` ≈ ${formatLocal(price.presentmentDue, price.presentmentCurrency)}` : ''
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

// ============ 汇率 ============

/**
 * 最近一次从 Stripe 结算页拿到的汇率（1 USD = rate 展示币种）。
 * 只有提取过才知道 Stripe 给国内 IP 用的是哪个币种、多少汇率；
 * 记在本地，档位卡片上「≈ ¥xx」的估算就用它，提取一次更新一次。
 */
const RATE_STORAGE_KEY = 'kal.paymentLink.rate'

export interface StoredRate {
  currency: string
  rate: number
  at: number
}

function rememberRate(currency: string, rate: number): void {
  if (currency === 'USD' || !(rate > 0)) return
  try {
    localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify({ currency, rate, at: Date.now() }))
  } catch {
    /* 不可写就不记 */
  }
}

export function readRate(): StoredRate | null {
  try {
    const saved = JSON.parse(localStorage.getItem(RATE_STORAGE_KEY) || 'null') as StoredRate | null
    return saved && saved.rate > 0 && saved.currency ? saved : null
  } catch {
    return null
  }
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
    return { state: 'fail', error: errorMessage(e) }
  }
}
