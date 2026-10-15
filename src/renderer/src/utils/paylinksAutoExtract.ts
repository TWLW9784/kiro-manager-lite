// 按网站派单的缺口自动提取：客户的批次要 N 条某档位，池子里不够，就从本机 Free 号里提取补上
//
// 候选规则与「批量提取」面板默认勾选的一致：只要 Free、没提取过（或链接已失效）、
// 没被判过「无优惠」、不是封禁 / 凭证失效、不是订阅过又掉回 Free 的老号；新导入的优先。
// 每轮多提 20% 余量（有的号会因为没有优惠被跳过），封顶 40 条，不够的下一轮接着补。
import { useAccountsStore } from '@/stores/accounts'
import { paymentLinkState, paymentLinkTier } from '@shared/paymentLink'
import { shouldSkipAccountUsageRefresh } from '@shared/refreshPolicy'
import type { Account, SubscriptionPlan } from '@shared/types'
import { runPool } from './format'
import { toPlain } from './ipc'
import { extractPaymentLink, readDiscountSetting, type PlanTarget } from './paymentLinkExtract'

const CONCURRENCY = 10
const MAX_PER_ROUND = 40
const FREE_LIMIT = 50

/**
 * 网站上的档位名（pro / pro+ / promax / power）→ 下单用的档位。
 * 档位列表要登录门户才能查，查一次缓存在内存里；派单的档位名用 paymentLinkTier 同一套规则对上。
 */
let planCache: SubscriptionPlan[] | null = null

async function planFor(tier: string, probeId: string): Promise<PlanTarget | null> {
  if (!planCache) {
    const store = useAccountsStore()
    const res = await window.api.getSubscriptionPlans(toPlain(await store.freshAccount(probeId)))
    if (!res.success || !res.data?.plans.length) return null
    planCache = res.data.plans
  }
  const plan = planCache.find(
    (p) => p.amount > 0 && paymentLinkTier({ planTitle: p.title, subscriptionType: p.subscriptionType }) === tier
  )
  return plan ? { subscriptionType: plan.subscriptionType, title: plan.title, amount: plan.amount, currency: plan.currency } : null
}

/**
 * 可以拿来提取的 Free 号。
 * 链接失效又没付的排最前：这些号上次提取时已经验过有新用户优惠，重新提取基本都能成；
 * 没提取过的号还不知道有没有优惠，放后面。同一组里新导入的在前。
 */
function candidates(maxLimits: Record<string, number>): Account[] {
  const store = useAccountsStore()
  const now = Date.now()
  const pool = store.accounts.filter((a) => {
    if (a.subscription.type !== 'Free') return false
    if (a.discountCheck || shouldSkipAccountUsageRefresh(a)) return false
    if ((maxLimits[a.id] ?? a.usage.limit ?? 0) > FREE_LIMIT) return false
    const state = paymentLinkState(a, now)
    return state === 'none' || state === 'expired'
  })
  const rank = (a: Account): number => (paymentLinkState(a, now) === 'expired' ? 0 : 1)
  return pool.sort((x, y) => rank(x) - rank(y) || (y.createdAt || 0) - (x.createdAt || 0))
}

/** 正在补的，避免两轮同时跑 */
let running = false

/**
 * 按缺口补链接，返回这轮提取成功的条数。
 * shortage 是网站同步返回的 {档位: 还差几条}。
 */
export async function fillShortage(shortage: Record<string, number>): Promise<{ ok: number; tried: number }> {
  const tiers = Object.entries(shortage).filter(([, n]) => n > 0)
  if (!tiers.length || running) return { ok: 0, tried: 0 }
  running = true
  try {
    const limits = await window.api.getMaxUsageLimits().catch(() => null)
    const pool = candidates(limits?.success && limits.data ? limits.data : {})
    if (!pool.length) return { ok: 0, tried: 0 }
    const setting = readDiscountSetting()
    let ok = 0
    let tried = 0
    let cursor = 0
    for (const [tier, need] of tiers) {
      const target = await planFor(tier, pool[0].id)
      if (!target) continue
      const take = Math.min(MAX_PER_ROUND, Math.ceil(need * 1.2), pool.length - cursor)
      const batch = pool.slice(cursor, cursor + take)
      cursor += take
      tried += batch.length
      await runPool(
        batch,
        CONCURRENCY,
        async (account) => {
          const res = await extractPaymentLink(account.id, target, setting)
          if (res.state === 'ok') ok++
        },
        { staggerMs: 400 }
      )
    }
    return { ok, tried }
  } finally {
    running = false
  }
}