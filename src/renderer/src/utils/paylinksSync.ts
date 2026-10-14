// 代付链接网站同步
//
// 每分钟一轮（有待回报的事情时 5 秒后再来一轮）：
//   1. 推送：本地「待付款」链接推到网站；换过新链接的，把旧链接哈希一起发过去让网站下架
//   2. 回写：网站上的状态（已领 / 已付 / 确认中 / 待换新）写回本地标记
//   3. 处理网站标出来的事：
//      - refresh（领走 3 小时未付、客户放回、链接失效）→ 重新提取一条新链接，下一轮推上去替换旧的
//      - checking（Stripe 显示不能再付，分不出付了还是失效）→ 刷一次 Kiro 档位，回报 paid / expired
//      - 可领取但金额已不是最优（首期按剩余天数折算，放久了重新生成会更便宜）→ 重新提取
// 网站上只有链接、档位、金额；邮箱与凭证不出本机，账号只用哈希对应。
import { ref } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { isPaidSubscription, paymentLinkTier } from '@shared/paymentLink'
import type { Account, PaylinksServerLink, PaylinksSyncBody, PaylinksUpsert } from '@shared/types'
import { auditEmails } from './audit'
import { fillShortage } from './paylinksAutoExtract'
import {
  extractPaymentLink,
  linkCny,
  optimizableSaving,
  readDiscountSetting,
  type PlanTarget
} from './paymentLinkExtract'

const INTERVAL_MS = 60_000
const FOLLOW_UP_MS = 5_000
/** 每轮最多重新提取几条（换新 + 优化价格合计），免得一次把门户请求打满 */
const MAX_REEXTRACT_PER_ROUND = 6
/** 每轮最多查几个号的 Kiro 档位来确认「确认中」的链接 */
const MAX_CONFIRM_PER_ROUND = 10

export const paylinksSyncState = ref<{
  running: boolean
  lastAt: number
  lastError: string
  lastSummary: string
}>({ running: false, lastAt: 0, lastError: '', lastSummary: '' })

let timer: ReturnType<typeof setTimeout> | null = null
let busy = false
/** 下一轮要带上的回报：checking 链接确认后的结果、要下架的旧链接 */
let pendingResolve: NonNullable<PaylinksSyncBody['resolve']> = []
let pendingSupersede: string[] = []
let pendingRelist: string[] = []
/**
 * 每条链接换新试了几次。
 *
 * Kiro 的 GenerateSubscriptionManagementUrl 常常对同一个账号返回同一个 Checkout Session，
 * 换出来的链接和旧的一样，网站上那行就一直停在 refresh。没有上限的话每轮都会再试一次，
 * 而每次都要走一遍门户 + Stripe 请求。超过上限就只上架旧链接、不再换了。
 */
const refreshTries = new Map<string, number>()
const MAX_REFRESH_TRIES = 2

function schedule(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void round(), ms)
}

/** 开关或地址变了就重新对齐：开着就立刻跑一轮，关了就停 */
export function startPaylinksSync(): void {
  const settings = useSettingsStore().settings
  if (timer) clearTimeout(timer)
  timer = null
  if (settings.paylinksSyncEnabled && settings.paylinksServerUrl && settings.paylinksSyncToken) schedule(1_000)
}

export function stopPaylinksSync(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

/** 手动立刻同步一次（设置里的「测试连接 / 立即同步」） */
export async function syncNow(): Promise<void> {
  await round()
}

function tierTarget(account: Account): PlanTarget | null {
  const link = account.paymentLink
  if (!link) return null
  return { subscriptionType: link.subscriptionType, title: link.planTitle, amount: link.amount, currency: link.currency }
}

async function round(): Promise<void> {
  if (busy) return
  const settings = useSettingsStore().settings
  if (!settings.paylinksSyncEnabled || !settings.paylinksServerUrl || !settings.paylinksSyncToken) return
  busy = true
  paylinksSyncState.value.running = true
  let followUp = false
  try {
    followUp = await syncOnce(settings.paylinksServerUrl, settings.paylinksSyncToken)
    paylinksSyncState.value.lastError = ''
  } catch (e) {
    paylinksSyncState.value.lastError = e instanceof Error ? e.message : String(e)
    void window.api.writeLog('warn', `[PaylinksSync] 同步失败：${paylinksSyncState.value.lastError}`)
  } finally {
    busy = false
    paylinksSyncState.value.running = false
    paylinksSyncState.value.lastAt = Date.now()
    if (useSettingsStore().settings.paylinksSyncEnabled) schedule(followUp ? FOLLOW_UP_MS : INTERVAL_MS)
  }
}

/** 一轮同步；返回 true 表示还有回报没发出去，要尽快再来一轮 */
async function syncOnce(serverUrl: string, token: string): Promise<boolean> {
  const store = useAccountsStore()
  const since = useSettingsStore().settings.paylinksSyncSince || 0
  // 推送范围：本地待付款（Kiro 还是 Free、链接没被 Stripe 判死）的；
  // 开启同步之前提取的不推（可能已经用 TXT 发出去了），已经推过的照常跟进
  const pending = store.accounts.filter(
    (a) =>
      a.paymentLink &&
      !isPaidSubscription(a.subscription.type) &&
      a.paymentLink.stripeStatus !== 'complete' &&
      a.paymentLink.stripeStatus !== 'expired' &&
      (a.paymentLink.createdAt >= since || !!a.paymentLink.syncedHash)
  )
  const marked = store.accounts.filter((a) => a.paymentLink)
  const hashes = await window.api.paylinksHashes({
    accountIds: marked.map((a) => a.id),
    urls: marked.map((a) => a.paymentLink!.url)
  })
  if (!hashes.success || !hashes.data) throw new Error(hashes.error || '计算哈希失败')
  const { accountRefs, urlHashes } = hashes.data

  const upsert: PaylinksUpsert[] = []
  const supersede = new Set(pendingSupersede)
  for (const account of pending) {
    const link = account.paymentLink!
    const hash = urlHashes[link.url]
    // 换过新链接：旧的要下架
    if (link.syncedHash && link.syncedHash !== hash) supersede.add(link.syncedHash)
    if (link.syncedHash === hash) continue
    upsert.push({
      url: link.url,
      account_ref: accountRefs[account.id],
      tier: tierName(link),
      amount_due: link.amountDue,
      amount_cny: linkCny(link),
      list_price: link.amount,
      extracted_at: link.createdAt
    })
  }

  const state = paylinksSyncState.value
  const body: PaylinksSyncBody = {
    client: {
      version: useSettingsStore().appInfo?.version ?? '',
      last_summary: state.lastSummary.slice(0, 200),
      last_error: state.lastError.slice(0, 200)
    },
    upsert,
    supersede: [...supersede],
    resolve: pendingResolve,
    relist: pendingRelist
  }
  const res = await window.api.paylinksSync(serverUrl, token, body)
  if (!res.success || !res.data) throw new Error(res.error || '同步失败')
  pendingResolve = []
  pendingSupersede = []
  pendingRelist = []

  // 回写：推上去的记下哈希；网站上的状态写回本地标记
  const byRef = new Map<string, Account>()
  for (const account of store.accounts) if (account.paymentLink) byRef.set(accountRefs[account.id], account)
  const patches: Parameters<typeof store.patchPaymentLinks>[0] = []
  const pushed = new Set(upsert.map((u) => u.url))
  const serverByAccount = new Map<string, PaylinksServerLink>()
  /**
   * 网站标成「确认中」的，按账号归拢。旧链接（已换新）和本地已不算待付款的号也要确认：
   * 客户可能付的就是旧链接，或者本地早就知道付了；不回报的话网站上会一直卡在确认中。
   */
  const checking = new Map<string, PaylinksServerLink[]>()
  /**
   * 号在本地已经是付费档、网站上却没记已付：被客户领过的链接（已领 / 待换新 / 已下架的旧链接）里挑一条补记。
   * 客户手里留着旧链接（TXT、截图）照样能付，网站上早已换新下架，不补的话结算会漏。
   */
  const paidElsewhere = new Map<string, PaylinksServerLink[]>()
  const paidRefs = new Set<string>()
  const add = (map: Map<string, PaylinksServerLink[]>, id: string, item: PaylinksServerLink): void => {
    const list = map.get(id) ?? []
    list.push(item)
    map.set(id, list)
  }
  for (const item of res.data.links) {
    const account = byRef.get(item.account_ref)
    if (!account?.paymentLink) continue
    const link = account.paymentLink
    const current = urlHashes[link.url] === item.url_hash
    const stillPending = pending.includes(account)
    if (item.status === 'paid') paidRefs.add(item.account_ref)
    if (item.status === 'checking') add(checking, account.id, item)
    else if (
      item.claimed_at &&
      ['claimed', 'refresh', 'superseded'].includes(item.status) &&
      isPaidSubscription(account.subscription.type)
    ) {
      add(paidElsewhere, account.id, item)
    }
    // 已下架的只用来补记已付，其余一概不管
    if (item.status === 'superseded') continue
    if (!current || !stillPending) {
      // 旧链接（已换新）或本地已不需要付款的号：还没卖出去的下架；已领走 / 已付的保持原样
      if (item.status === 'available' || item.status === 'refresh') pendingSupersede.push(item.url_hash)
      if (current && item.status === 'paid') {
        patches.push({ id: account.id, url: link.url, patch: { serverStatus: 'paid', stripeStatus: 'complete' } })
      }
      continue
    }
    serverByAccount.set(account.id, item)
    patches.push({
      id: account.id,
      url: link.url,
      patch: {
        serverStatus: item.status,
        serverClaimedAt: item.claimed_at ?? undefined,
        syncedHash: item.url_hash,
        ...(item.status === 'paid' ? { stripeStatus: 'complete' as const, stripeCheckedAt: Date.now() } : {})
      }
    })
  }
  // 推上去了、但网站返回里没有的（网站早已下架过），也记下哈希，免得每轮重复推
  for (const account of pending) {
    if (!pushed.has(account.paymentLink!.url) || serverByAccount.has(account.id)) continue
    patches.push({ id: account.id, url: account.paymentLink!.url, patch: { syncedHash: urlHashes[account.paymentLink!.url] } })
  }
  store.patchPaymentLinks(patches)

  // ============ 处理网站标出来的事 ============
  const setting = readDiscountSetting()
  const nowMs = Date.now()
  let budget = MAX_REEXTRACT_PER_ROUND
  const summary = {
    pushed: upsert.length,
    refreshed: 0,
    optimized: 0,
    confirmedPaid: 0,
    confirmedExpired: 0,
    dropped: 0,
    relisted: 0
  }
  const refreshedEmails: string[] = []

  // 确认中：本地已经是付费档的直接回报；还是 Free 的刷一次 Kiro 档位定性（按轮限额）
  let checkBudget = MAX_CONFIRM_PER_ROUND
  for (const [id, items] of checking) {
    const account = store.get(id)
    if (!account?.paymentLink) continue
    if (!isPaidSubscription(account.subscription.type)) {
      if (checkBudget <= 0) continue
      checkBudget--
      const res = await store.checkStatus(id).catch(() => ({ ok: false }))
      if (!res.ok) continue
    }
    const fresh = store.get(id)
    const paid = !!fresh && isPaidSubscription(fresh.subscription.type)
    const ref = accountRefs[id]
    // 一个号只付得了一次：已经有一条记成已付的，其余都算失效；否则只认一条（当前链接优先，再按领取时间最新）
    const winner = paid && !paidRefs.has(ref) ? pickPaid(items, fresh?.paymentLink ? urlHashes[fresh.paymentLink.url] : '') : null
    if (winner) paidRefs.add(ref)
    for (const item of items) {
      const result = item === winner ? 'paid' : 'expired'
      pendingResolve.push({ url_hash: item.url_hash, result })
      if (result === 'paid') summary.confirmedPaid++
      else summary.confirmedExpired++
    }
  }

  // 号已付费、网站没记：每个号补记一条（没被上面确认中那段记过的才补）；其余的照常由下架逻辑处理
  for (const [id, items] of paidElsewhere) {
    const ref = accountRefs[id]
    if (paidRefs.has(ref)) continue
    const account = store.get(id)
    const winner = pickPaid(items, account?.paymentLink ? urlHashes[account.paymentLink.url] : '')
    paidRefs.add(ref)
    pendingResolve.push({ url_hash: winner.url_hash, result: 'paid' })
    // 同一轮里别再让网站把它下架
    pendingSupersede = pendingSupersede.filter((h) => h !== winner.url_hash)
    summary.confirmedPaid++
  }

  for (const [id, item] of serverByAccount) {
    const account = store.get(id)
    if (!account?.paymentLink) continue
    if (item.status === 'checking') continue

    // 换新链接 / 价格优化都要重新提取，按轮限额
    const needRefresh = item.status === 'refresh'
    const needOptimize = item.status === 'available' && isWorthOptimizing(account, item, nowMs)
    if ((!needRefresh && !needOptimize) || budget <= 0) continue

    // 试过几次都换不出新链接：旧链接还能付，直接重新上架，不再浪费请求
    const tries = refreshTries.get(item.url_hash) ?? 0
    if (needRefresh && tries >= MAX_REFRESH_TRIES) {
      pendingRelist.push(item.url_hash)
      summary.relisted++
      continue
    }

    const target = tierTarget(account)
    if (!target) continue
    budget--
    const before = account.paymentLink.url
    const result = await extractPaymentLink(id, target, setting)
    const after = store.get(id)?.paymentLink?.url
    if (result.state === 'ok' && after && after !== before) {
      // 新链接下一轮推上去，旧的同时下架
      refreshTries.delete(item.url_hash)
      if (needRefresh) summary.refreshed++
      else summary.optimized++
      refreshedEmails.push(account.email)
    } else if (result.state === 'ok') {
      // Kiro 又给了同一个会话：链接没变，记一次失败，到上限就重新上架
      refreshTries.set(item.url_hash, tries + 1)
      if (needRefresh && tries + 1 >= MAX_REFRESH_TRIES) {
        pendingRelist.push(item.url_hash)
        summary.relisted++
      }
    } else if (needRefresh && result.state === 'skip') {
      // 换不了新的（没有优惠了、已经订阅了）：网站上的旧链接直接下架，不再挂着
      pendingSupersede.push(item.url_hash)
      summary.dropped++
    }
  }

  const parts = [
    summary.pushed && `推送 ${summary.pushed}`,
    summary.refreshed && `换新 ${summary.refreshed}`,
    summary.optimized && `价格优化 ${summary.optimized}`,
    summary.confirmedPaid && `确认已付 ${summary.confirmedPaid}`,
    summary.confirmedExpired && `确认失效 ${summary.confirmedExpired}`,
    summary.dropped && `下架 ${summary.dropped}`,
    summary.relisted && `原链接重新上架 ${summary.relisted}`
  ].filter((x): x is string => !!x)
  // 派了单、池子不够：按缺口自动提取（并发 10），提出来的下一轮推上去
  const shortage = res.data.shortage
  let filled = 0
  if (shortage && !Array.isArray(shortage) && Object.keys(shortage).length) {
    const r = await fillShortage(shortage as Record<string, number>)
    filled = r.ok
    if (r.tried) parts.push(`按派单缺口自动提取 ${r.ok}/${r.tried}`)
  }

  paylinksSyncState.value.lastSummary = parts.length ? parts.join('，') : '无变化'
  if (parts.length) {
    auditEmails('info', 'PaylinksSync', `网站同步：${parts.join('，')}`, refreshedEmails)
  }
  // 有回报 / 下架没发出去，或者刚换了新链接要推上去：尽快再来一轮
  return (
    pendingResolve.length > 0 ||
    pendingSupersede.length > 0 ||
    pendingRelist.length > 0 ||
    summary.refreshed + summary.optimized + filled > 0
  )
}

/** 同一个号有几条确认中、号确实付了：只记一条已付（当前链接优先，否则领取时间最新的） */
function pickPaid(items: PaylinksServerLink[], currentHash: string): PaylinksServerLink {
  return (
    items.find((i) => i.url_hash === currentHash) ??
    [...items].sort((a, b) => String(b.claimed_at ?? '').localeCompare(String(a.claimed_at ?? '')))[0]
  )
}

/** 网站上显示的档位名：pro / pro+ / promax / power */
function tierName(link: NonNullable<Account['paymentLink']>): string {
  return paymentLinkTier(link)
}

/** 可领取的链接值不值得换新（只换还没被领走的，领走的在客户手里不能动） */
function isWorthOptimizing(account: Account, item: PaylinksServerLink, nowMs: number): boolean {
  const link = account.paymentLink
  if (!link) return false
  const current = item.amount_due !== null ? Number(item.amount_due) : undefined
  return optimizableSaving(link, account.subscription.expiresAt, nowMs, current) > 0
}