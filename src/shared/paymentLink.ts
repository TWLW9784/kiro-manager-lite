// 支付链接标记的判定口径：账号卡片、筛选面板、批量提取弹窗都走这里
import { normalizeSubscriptionType } from './subscription'
import type { Account, SubscriptionType } from './types'

/**
 * 支付链接标记状态：
 * - none     没提取过
 * - pending  提取过、还没付，链接仍有效（待付款）
 * - expired  没付且链接已失效（Stripe 报 expired，或超过 24 小时且没确认过仍有效），可重新提取
 * - paid     已付款：账号当前档位与目标档位一致，或 Stripe 已显示付款完成（Kiro 可能还没同步）
 * - other    账号已订阅，但不是链接的目标档位（多半是走了别的渠道开通）
 */
export type PaymentLinkState = 'none' | 'pending' | 'expired' | 'paid' | 'other'

export const PAYMENT_LINK_STATES: PaymentLinkState[] = ['none', 'pending', 'expired', 'paid', 'other']

/**
 * Stripe Checkout Session 默认 24 小时失效；没向 Stripe 确认过的链接超过这个时间按失效处理。
 * 实际可能更早失效（实测同一账号再生成链接后旧会话立即失效），所以界面以 Stripe 的实时结果为准。
 */
export const PAYMENT_LINK_TTL_MS = 24 * 60 * 60 * 1000

/** 算作「已付费订阅」的档位；Student 是认证档位不经过 Stripe，和 Free 一样仍可下单 */
const PAID_TYPES = new Set<SubscriptionType>(['Pro', 'Pro_Plus', 'Pro_Max', 'Power', 'Teams'])

export function isPaidSubscription(type: SubscriptionType): boolean {
  return PAID_TYPES.has(type)
}

/** 链接对应的档位：标题（KIRO PRO+）优先，缺失时用订阅类型（..._PRO_PLUS）兜底 */
export function paymentLinkTargetType(link: { planTitle?: string; subscriptionType?: string }): SubscriptionType {
  return normalizeSubscriptionType(link.planTitle || link.subscriptionType || '')
}

export function paymentLinkState(
  account: Pick<Account, 'paymentLink' | 'subscription'>,
  nowMs = Date.now()
): PaymentLinkState {
  const link = account.paymentLink
  if (!link) return 'none'
  const current = account.subscription.type
  if (isPaidSubscription(current)) return current === paymentLinkTargetType(link) ? 'paid' : 'other'
  // Kiro 还是 Free，但 Stripe 已经收到钱：算已付款，等 Kiro 同步
  if (link.stripeStatus === 'complete') return 'paid'
  if (link.stripeStatus === 'expired') return 'expired'
  // 没向 Stripe 确认过（或上次确认已是 24 小时前）且超过有效期，按失效处理
  const confirmedOpen = link.stripeStatus === 'open' && !isPaymentLinkStale({ createdAt: link.stripeCheckedAt ?? 0 }, nowMs)
  if (isPaymentLinkStale(link, nowMs) && !confirmedOpen) return 'expired'
  return 'pending'
}

/** Stripe 显示已付款，但 Kiro 的订阅档位还没变过来 */
export function isAwaitingKiroSync(account: Pick<Account, 'paymentLink' | 'subscription'>): boolean {
  return account.paymentLink?.stripeStatus === 'complete' && !isPaidSubscription(account.subscription.type)
}

/** 距 createdAt 已超过结算会话的默认有效期 */
export function isPaymentLinkStale(link: { createdAt: number }, nowMs = Date.now()): boolean {
  return nowMs - link.createdAt > PAYMENT_LINK_TTL_MS
}

const TIER_LABELS: Partial<Record<SubscriptionType, string>> = {
  Pro: 'pro',
  Pro_Plus: 'pro+',
  Pro_Max: 'promax',
  Power: 'power'
}

/** 导出 / 复制用的订阅等级短名：pro、pro+、promax、power；认不出的档位用标题小写兜底 */
export function paymentLinkTier(link: { planTitle?: string; subscriptionType?: string }): string {
  const type = paymentLinkTargetType(link)
  return TIER_LABELS[type] ?? (link.planTitle || link.subscriptionType || '').toLowerCase()
}

/** 接口返回的是 billing.stripe.com 的账单管理链接，说明账号已经有订阅 */
export function isManageUrl(url: string): boolean {
  return /billing\.stripe\.com/i.test(url)
}
