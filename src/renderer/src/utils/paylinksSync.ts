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

  const body: PaylinksSyncBody = { upsert, supersede: [...supersede], resolve: pendingResolve }
  const res = await window.api.paylinksSync(serverUrl, token, body)
  if (!res.success || !res.data) throw new Error(res.error || '同步失败')
  pendingResolve = []
  pendingSupersede = []

  // 回写：推上去的记下哈希；网站上的状态写回本地标记
  const byRef = new Map<string, Account>()
  for (const account of store.accounts) if (account.paymentLink) byRef.set(accountRefs[account.id], account)
  const patches: Parameters<typeof store.patchPaymentLinks>[0] = []
  const pushed = new Set(upsert.map((u) => u.url))
  const serverByAccount = new Map<string, PaylinksServerLink>()
  for (const item of res.data.links) {
    const account = byRef.get(item.account_ref)
    if (!account?.paymentLink) continue
    const link = account.paymentLink
    const current = urlHashes[link.url] === item.url_hash
    const stillPending = pending.includes(account)
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
  const summary = { pushed: upsert.length, refreshed: 0, optimized: 0, confirmedPaid: 0, confirmedExpired: 0, dropped: 0 }
  const refreshedEmails: string[] = []

  for (const [id, item] of serverByAccount) {
    const account = store.get(id)
    if (!account?.paymentLink) continue

    if (item.status === 'checking') {
      // 不能再付了：刷一次 Kiro 档位定性
      const res = await store.checkStatus(id).catch(() => ({ ok: false }))
      if (!res.ok) continue
      const fresh = store.get(id)
      const paid = !!fresh && isPaidSubscription(fresh.subscription.type)
      pendingResolve.push({ url_hash: item.url_hash, result: paid ? 'paid' : 'expired' })
      if (paid) summary.confirmedPaid++
      else summary.confirmedExpired++
      continue
    }

    // 换新链接 / 价格优化都要重新提取，按轮限额
    const needRefresh = item.status === 'refresh'
    const needOptimize = item.status === 'available' && isWorthOptimizing(account, item, nowMs)
    if ((!needRefresh && !needOptimize) || budget <= 0) continue
    const target = tierTarget(account)
    if (!target) continue
    budget--
    const result = await extractPaymentLink(id, target, setting)
    if (result.state === 'ok') {
      // 新链接下一轮推上去，旧的同时下架
      if (needRefresh) summary.refreshed++
      else summary.optimized++
      refreshedEmails.push(account.email)
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
    summary.dropped && `下架 ${summary.dropped}`
  ].filter(Boolean)
  paylinksSyncState.value.lastSummary = parts.length ? parts.join('，') : '无变化'
  if (parts.length) {
    auditEmails('info', 'PaylinksSync', `网站同步：${parts.join('，')}`, refreshedEmails)
  }
  // 有回报 / 下架没发出去，或者刚换了新链接要推上去：尽快再来一轮
  return pendingResolve.length > 0 || pendingSupersede.length > 0 || summary.refreshed + summary.optimized > 0
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