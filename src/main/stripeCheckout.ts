// 读 Stripe 结算页的实付金额：新用户优惠只体现在 Checkout Session 上
//
// Kiro 的 GetAvailableSubscriptionPlans 只给标价（Pro+ 永远是 40），
// 新账号的 $20 余额抵扣、首期按天折算后今天要付多少，只有 Stripe 那边的 Session 知道。
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

/** 没有小数位的币种：金额字段就是整数元，不用除以 100 */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 结算页展示币种 → 美元的汇率（1 USD = rate 展示币种）。
 *
 * 国内 IP 打开时 Stripe 走 Adaptive Pricing，金额字段全是人民币；
 * adaptive_pricing_info.local_currency_options 里带着这次用的汇率，用它换回美元，
 * 与 Kiro 标价（USD）在同一个口径上比较。
 */
function usdRate(data: Json, presentment: string): number {
  if (presentment === 'usd') return 1
  const adaptive = obj(data.adaptive_pricing_info)
  if (adaptive && String(adaptive.integration_currency).toLowerCase() === 'usd') {
    const options = Array.isArray(adaptive.local_currency_options) ? adaptive.local_currency_options : []
    const option = options.map(obj).find((o) => String(o?.currency).toLowerCase() === presentment)
    const rate = Number(option?.presentment_exchange_rate)
    if (Number.isFinite(rate) && rate > 0) return rate
    // 没给汇率时用同一笔金额的两种币种反推
    const usd = num(adaptive.integration_amount)
    const local = num(option?.amount)
    if (usd && local) return local / usd
  }
  throw new Error(`结算页按 ${presentment.toUpperCase()} 展示，但没有找到换算成美元的汇率`)
}

/**
 * 从 init 响应里取金额，统一换算成美元。字段含义见 CheckoutPrice 的说明。
 * total_summary 是结算页右侧「今日应付」那一栏的数据源，invoice 作为兜底。
 */
export function extractCheckoutPrice(data: Json): CheckoutPrice {
  const summary = obj(data.total_summary)
  const invoice = obj(data.invoice)
  const presentment = String(invoice?.currency ?? data.currency ?? 'usd').toLowerCase()

  const due = num(summary?.due) ?? num(invoice?.amount_due)
  if (due === undefined) throw new Error('Stripe 返回里没有找到应付金额')
  const subtotal = num(summary?.subtotal) ?? num(invoice?.subtotal) ?? due
  // applied_balance 为负表示从客户余额里抵扣（新用户的 $20 就在这里）
  const balance = num(summary?.applied_balance) ?? num(invoice?.applied_balance) ?? 0
  const discount = num(summary?.total_discount_amount_aggregate) ?? 0
  const recurring = num(obj(obj(data.recurring_details)?.total_summary)?.due)

  const divisor = ZERO_DECIMAL.has(presentment) ? 1 : 100
  const rate = usdRate(data, presentment)
  const usd = (minor: number): number => round2(minor / divisor / rate)

  return {
    amountDue: usd(due),
    subtotal: usd(subtotal),
    credit: usd(Math.max(0, -balance) + Math.max(0, discount)),
    recurring: recurring === undefined ? undefined : usd(recurring),
    presentmentCurrency: presentment.toUpperCase(),
    presentmentDue: round2(due / divisor)
  }
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
  return extractCheckoutPrice(data)
}
