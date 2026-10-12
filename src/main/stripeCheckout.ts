// 读 Stripe 结算页的实付金额：新用户优惠只体现在 Checkout Session 上
//
// Kiro 的 GetAvailableSubscriptionPlans 只给标价（Pro+ 永远是 40），
// 新账号有没有优惠券、优惠后要付多少，只有 Stripe 那边的 Session 知道。
// 这里做的就是浏览器打开结算页时的第一步：
//   1. 结算链接形如 https://checkout.stripe.com/c/pay/cs_live_xxx#<fragment>，
//      fragment 是 URL 编码的 base64，解码后每个字节异或 5 得到 JSON，里面有 apiKey（pk_live_…）；
//   2. 用 pk 调 POST https://api.stripe.com/v1/payment_pages/{cs}/init，
//      返回的就是结算页渲染用的数据，含应付总额与折扣。
// 只读不写：init 不会扣款，也不会改 Session 状态。
import { httpRequest } from './net'
import { inAppChromeUserAgent } from './kiroPortal'
import type { CheckoutPrice } from '../shared/types'

const STRIPE_API = 'https://api.stripe.com/v1'

/** 从结算链接拆出 Session id 与 publishable key */
export function parseCheckoutUrl(url: string): { sessionId: string; publishableKey: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('支付链接格式不正确')
  }
  const sessionId = parsed.pathname.match(/(cs_(?:live|test)_[A-Za-z0-9]+)/)?.[1]
  if (!sessionId) throw new Error('支付链接里没有 Checkout Session id')

  const fragment = parsed.hash.replace(/^#/, '')
  if (!fragment) throw new Error('支付链接缺少 Stripe 参数片段')
  let json = ''
  try {
    const bytes = Buffer.from(decodeURIComponent(fragment), 'base64')
    json = Buffer.from(bytes.map((b) => b ^ 5)).toString('utf-8')
  } catch {
    throw new Error('无法解码支付链接参数')
  }
  const publishableKey = json.match(/"apiKey"\s*:\s*"(pk_(?:live|test)_[^"]+)"/)?.[1]
  if (!publishableKey) throw new Error('支付链接参数里没有 publishable key')
  return { sessionId, publishableKey }
}

type Json = Record<string, unknown>

function obj(value: unknown): Json | undefined {
  return value && typeof value === 'object' ? (value as Json) : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 从 init 响应里取金额。Stripe 没有公开这个接口的结构，不同模式字段位置不同，
 * 按「今天应付」优先的顺序逐个找，命中哪条记在 source 里，便于对照排查。
 * 金额是最小货币单位（美分），这里换算成元。
 */
export function extractCheckoutPrice(data: Json): CheckoutPrice {
  const groups: [string, Json | undefined][] = [
    ['invoice', obj(data.invoice)],
    ['line_item_group', obj(data.line_item_group)],
    ['total_summary', obj(data.total_summary)],
    ['root', data]
  ]
  const dueKeys = ['amount_due', 'due', 'total', 'amount_total']
  const currency = String(
    groups.map(([, g]) => g?.currency).find((c) => typeof c === 'string') ?? data.currency ?? 'usd'
  ).toUpperCase()

  for (const [name, group] of groups) {
    if (!group) continue
    for (const key of dueKeys) {
      const due = num(group[key])
      if (due === undefined) continue
      const subtotal = num(group.subtotal) ?? num(group.amount_subtotal)
      return {
        amountDue: due / 100,
        subtotal: subtotal === undefined ? undefined : subtotal / 100,
        currency,
        source: `${name}.${key}`
      }
    }
  }
  throw new Error('Stripe 返回里没有找到应付金额')
}

/** 查结算链接的实付金额 */
export async function probeCheckoutPrice(url: string): Promise<CheckoutPrice> {
  const { sessionId, publishableKey } = parseCheckoutUrl(url)
  const body = new URLSearchParams({
    key: publishableKey,
    eid: 'NA',
    browser_locale: 'en-US',
    redirect_type: 'url'
  }).toString()

  const res = await httpRequest(`${STRIPE_API}/payment_pages/${sessionId}/init`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://checkout.stripe.com',
      referer: 'https://checkout.stripe.com/',
      'user-agent': inAppChromeUserAgent()
    },
    body
  })
  const text = await res.text()
  // 只记状态码：Session id 等同于支付链接，不进日志
  console.debug(`[StripeCheckout] init → ${res.status}`)
  let data: Json
  try {
    data = JSON.parse(text) as Json
  } catch {
    throw new Error(`Stripe 返回无法解析：HTTP ${res.status}`)
  }
  if (!res.ok) {
    const message = obj(data.error)?.message
    throw new Error(`Stripe HTTP ${res.status}${message ? `: ${String(message)}` : ''}`)
  }
  const price = extractCheckoutPrice(data)
  console.debug(`[StripeCheckout] 金额取自 ${price.source}`)
  return price
}
