// 支付链接标记的判定口径：账号卡片、筛选面板、批量提取弹窗都走这里
import { normalizeSubscriptionType } from './subscription'
import type { Account, SubscriptionType } from './types'

/**
 * 支付链接标记状态：
 * - none     没提取过
 * - pending  提取过，账号还没订阅（待付款）
 * - paid     账号当前档位与链接的目标档位一致（已开通）
 * - other    账号已订阅，但不是链接的目标档位（多半是走了别的渠道开通）
 */
export type PaymentLinkState = 'none' | 'pending' | 'paid' | 'other'

export const PAYMENT_LINK_STATES: PaymentLinkState[] = ['none', 'pending', 'paid', 'other']

/**
 * Stripe Checkout Session 默认 24 小时失效。
 * 超过这个时间的待付款链接大概率打不开了，界面提示重新提取。
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

export function paymentLinkState(account: Pick<Account, 'paymentLink' | 'subscription'>): PaymentLinkState {
  const link = account.paymentLink
  if (!link) return 'none'
  const current = account.subscription.type
  if (!isPaidSubscription(current)) return 'pending'
  return current === paymentLinkTargetType(link) ? 'paid' : 'other'
}

/** 待付款且已超过有效期 */
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
