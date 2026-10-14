// 代付链接网站管理接口的类型与调用封装（服务端见 server/paylinks/inc/admin.php）
import { useSettingsStore } from '@/stores/settings'
import { toPlain } from './ipc'

export interface AdminClient {
  id: number
  username: string
  display_name: string
  enabled: number
  max_claim: number
  claim_timeout_minutes: number
  note: string
  last_login_at: string | null
  created_at: string
  claimed: string | null
  paid: string | null
  paid_today: string | null
  paid_usd: string | null
  paid_cny: string | null
  last_paid_at: string | null
  wallet_network: string
  wallet_token: string
  wallet_address: string
  wallet_updated_at: string | null
  /** 已结（USD）= 批次已结金额 + 没挂批次的打款 */
  settled: number
  /** 你要付给客户的（USD）：已付条数 × 单价；没设单价时按客户实付金额 */
  due: number
  /** 客户实际在 Stripe 付掉的（USD） */
  client_paid: number
  /** 客户赚的 = 付客户 − 客户实付 */
  client_profit: number
  /** 余额 = 已付客户 − 应付客户：正数是你预付的，负数是还欠客户 */
  balance: number
  /** 预付（余额为正时的金额） */
  prepaid: number
  /** 待结算 = 应付客户 − 已付客户（只在欠客户时 > 0） */
  unsettled: number
  /** 新批次默认的每条结算单价；null = 按实付金额 */
  unit_price: string | null
}

export interface AdminLink {
  id: number
  url_hash: string
  account_ref: string
  url: string
  tier: string
  amount_due: string | null
  amount_cny: string | null
  status: 'available' | 'claimed' | 'checking' | 'paid' | 'refresh' | 'superseded'
  client_id: number | null
  client: string | null
  claimed_at: string | null
  paid_at: string | null
  refresh_reason: string | null
  stripe_status: string | null
  stripe_checked_at: string | null
  extracted_at: string
  updated_at: string
}

export interface AdminOverview {
  now: string
  by_status: { status: string; tier: string; n: string; usd: string | null; cny: string | null }[]
  daily: { day: string; client_id: number | null; client: string; n: string; usd: string | null; cny: string | null }[]
  last_stripe_check: string | null
  desktop: { at: string; version: string; last_summary: string; last_error: string } | null
  stuck_checking: number
  settle: {
    due: number
    client_paid: number
    client_profit: number
    settled: number
    unsettled_orders: number
    open_orders: number
  }
}

export interface ClientInput {
  id?: number
  username: string
  password?: string
  display_name: string
  enabled: boolean
  max_claim: number
  claim_timeout_minutes: number
  note: string
  wallet_network?: string
  wallet_token?: string
  wallet_address?: string
  /** 空串 = 按实付金额 */
  unit_price?: number | string | null
}

/** 网站上链接状态的中文名与颜色 */
export const LINK_STATUS_META: Record<AdminLink['status'], { text: string; color: string }> = {
  available: { text: '可领取', color: 'blue' },
  claimed: { text: '已领待付', color: 'orange' },
  checking: { text: '确认付款中', color: 'gold' },
  paid: { text: '已付款', color: 'green' },
  refresh: { text: '待换新', color: 'default' },
  superseded: { text: '已作废', color: 'default' }
}

export const REFRESH_REASON_TEXT: Record<string, string> = {
  timeout: '领取超时',
  released: '客户放回',
  expired: '链接失效',
  revoked: '管理收回'
}

/** 同步没配好时给出明确的提示，而不是一个空白页 */
export function adminConfigured(): boolean {
  const s = useSettingsStore().settings
  return !!s.paylinksServerUrl && !!s.paylinksSyncToken
}

async function call<T>(body: { op: string } & Record<string, unknown>): Promise<T> {
  const s = useSettingsStore().settings
  // 筛选条件里的数组是响应式代理，IPC 结构化克隆不了（An object could not be cloned），先剥成普通对象
  const res = await window.api.paylinksAdmin(s.paylinksServerUrl, s.paylinksSyncToken, toPlain(body))
  if (!res.success || !res.data) throw new Error(res.error || '请求失败')
  return res.data as T
}

export const paylinksAdmin = {
  overview: () => call<AdminOverview>({ op: 'overview' }),
  clients: () => call<{ clients: AdminClient[] }>({ op: 'clients' }).then((r) => r.clients),
  saveClient: (input: ClientInput) => call<{ id: number }>({ op: 'client_save', ...input }),
  deleteClient: (id: number) => call({ op: 'client_delete', id }),
  kickClient: (id: number) => call({ op: 'client_kick', id }),
  links: (filter: {
    client_id?: number
    statuses?: string[]
    tier?: string
    from?: string
    to?: string
    order_id?: number
    /** 按批次看时连作废的旧链接一起列 */
    include_void?: number
    page?: number
    page_size?: number
  }) => call<{ total: number; links: AdminLink[] }>({ op: 'links', ...filter }),
  revokeLinks: (ids: number[]) => call<{ revoked: number }>({ op: 'link_revoke', ids }),
  orders: (filter: { client_id?: number; status?: string } = {}) =>
    call<{ orders: AdminOrder[] }>({ op: 'orders', ...filter }).then((r) => r.orders),
  /** 分页版：带筛选、搜索、按 id 取单个 */
  ordersPage: (filter: { id?: number; client_id?: number; status?: string; settle?: string; q?: string; page: number; page_size: number }) =>
    call<{ total: number; page: number; page_size: number; orders: AdminOrder[] }>({ op: 'orders', ...filter }),
  settleOrder: (input: { id: number; settle_status?: SettleStatus; settled_amount?: number; settle_note?: string; unit_price?: number | string | null }) =>
    call({ op: 'order_settle', ...input }),
  settlements: (filter: { client_id?: number; order_id?: number; page?: number; page_size?: number }) =>
    call<{ total: number; sum: number; page: number; page_size: number; settlements: AdminSettlement[] }>({ op: 'settlements', ...filter }),
  deleteSettlement: (id: number) => call({ op: 'settlement_delete', id }),
  logs: (filter: { filter_op?: string; page: number; page_size: number }) =>
    call<{ total: number; page: number; page_size: number; logs: AdminLog[] }>({ op: 'logs', ...filter }),
  resolveLink: (id: number, result: 'paid' | 'expired') => call({ op: 'link_resolve', id, result }),
  createOrder: (input: { client_id: number; tier: string; quantity: number; replace_limit?: number; note?: string; unit_price?: number }) =>
    call<{ id: number; code: string }>({ op: 'order_create', ...input }),
  updateOrder: (input: { id: number; quantity?: number; replace_limit?: number; status?: 'cancelled' | 'done' }) =>
    call({ op: 'order_update', ...input }),
  assignLinks: (input: { client_id: number; note?: string; links: AssignLinkInput[] }) =>
    call<{
      assigned: number
      code: string
      orders: { code: string; tier: string; quantity: number }[]
      conflicts: { url_hash: string; status: string }[]
    }>({ op: 'assign_links', ...input })
}

/** 分配给客户时每条链接带上的数据（邮箱不上传，账号只给哈希） */
export interface AssignLinkInput {
  url: string
  account_ref: string
  tier: string
  amount_due?: number
  amount_cny?: number
  list_price?: number
  extracted_at: number
  /** 本地已确认这个号付过款 */
  paid: boolean
}

/** 一个派单批次 */
export interface AdminOrder {
  id: number
  code: string
  client_id: number
  client: string | null
  tier: string
  quantity: number
  replace_limit: number
  replaced: number
  status: 'open' | 'done' | 'cancelled'
  settle_status: SettleStatus
  settled_amount: string
  settled_at: string | null
  settle_note: string
  /** 每条结算单价；null = 按实付金额 */
  unit_price: string | null
  /** 你要付给客户的（USD）：已付条数 × 单价，或客户实付合计 */
  due_amount: string
  /** 客户赚的 = due_amount − 客户实付合计 */
  client_profit: string
  /** 打款记录条数 */
  settlements: string | null
  wallet_network: string | null
  wallet_token: string | null
  wallet_address: string | null
  wallet_updated_at: string | null
  /** site 网站派单；offline 线下（TXT / Excel）发出后补建，不从池子领 */
  source: 'site' | 'offline'
  note: string
  created_at: string
  done_at: string | null
  paid: string | null
  holding: string | null
  /** 作废的（换过新链接 / 放回换新） */
  void: string | null
  paid_usd: string | null
  paid_cny: string | null
}

export const ORDER_STATUS_META: Record<AdminOrder['status'], { text: string; color: string }> = {
  open: { text: '进行中', color: 'processing' },
  done: { text: '已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'default' }
}

/** 随机密码：去掉易混的 0/O、1/l/I */
export function randomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export type SettleStatus = 'unsettled' | 'partial' | 'settled' | 'prepaid'

export const SETTLE_STATUS_META: Record<SettleStatus, { text: string; color: string }> = {
  unsettled: { text: '未结算', color: 'orange' },
  partial: { text: '部分结算', color: 'blue' },
  settled: { text: '已结清', color: 'green' },
  /** 先打款给客户、超过应付的部分 */
  prepaid: { text: '已预付', color: 'purple' }
}

/** 一笔打款（结算记录） */
export interface AdminSettlement {
  id: number
  client_id: number
  client: string | null
  order_id: number | null
  code: string | null
  amount: string
  token: string
  network: string
  network_name: string
  to_address: string
  tx_hash: string
  tx_url: string | null
  has_proof: boolean
  proof_mime: string
  note: string
  created_by: string
  paid_at: string
  created_at: string
}

export interface AdminLog {
  id: number
  at: string
  actor: string
  ip: string
  op: string
  detail: string
}

/** 可选的收款网络：只有 Polygon（与 server/paylinks/inc/lib.php 的 ENABLED_NETWORKS 一致） */
export const NETWORKS = [{ id: 'polygon', name: 'Polygon', evm: true }] as const
/** 历史记录里可能出现的网络名（以前开放过） */
const NETWORK_NAMES: Record<string, string> = { polygon: 'Polygon', ethereum: 'Ethereum', bsc: 'BNB Chain', arbitrum: 'Arbitrum', tron: 'Tron' }
export const TOKENS = ['USDT', 'USDC'] as const
export const networkName = (id: string | null | undefined): string => NETWORK_NAMES[id ?? ''] ?? (id || '-')
export function validAddress(_network: string, address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}
export function validTxHash(_network: string, hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash)
}
/** 收款地址 24 小时内改过：打款前提醒先跟客户确认 */
export function walletFresh(updatedAt: string | null | undefined): boolean {
  return !!updatedAt && Date.now() - Date.parse(`${updatedAt.replace(' ', 'T')}+08:00`) < 864e5
}

/** 记一笔打款（multipart，带凭证文件） */
export async function addSettlement(
  fields: { client_id: number; order_id?: number | null; amount: number; token: string; network: string; to_address: string; tx_hash: string; paid_at: string; note: string },
  proof?: File | null
): Promise<{ id: number }> {
  const s = useSettingsStore().settings
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') flat[k] = String(v)
  const file = proof ? { name: proof.name, type: proof.type, data: new Uint8Array(await proof.arrayBuffer()) } : undefined
  const res = await window.api.paylinksSettlementAdd(s.paylinksServerUrl, s.paylinksSyncToken, flat, file)
  if (!res.success || !res.data) throw new Error(res.error || '记录打款失败')
  return res.data as { id: number }
}

/** 下载付款凭证并用系统默认程序打开 */
export async function openProof(id: number): Promise<void> {
  const s = useSettingsStore().settings
  const res = await window.api.paylinksProofOpen(s.paylinksServerUrl, s.paylinksSyncToken, id)
  if (!res.success) throw new Error(res.error || '打开凭证失败')
}

/** 结算会话号缩写：cs_live_a1b2…z9，界面上不展开整条链接 */
export function shortLink(url: string): string {
  const id = url.match(/cs_(?:live|test)_[A-Za-z0-9]+/)?.[0]
  if (id) return id.length > 22 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id
  return url.length > 40 ? `${url.slice(0, 28)}…${url.slice(-8)}` : url
}

/**
 * 筛选下拉的选项：第一项固定是「全部 xx」，值用空串。
 * 用 undefined 的话 a-select 匹配不到选项、显示成空白，所以统一用 ''，发请求前再转成 undefined。
 */
export function filterOptions<T extends string | number>(
  items: { value: T; label: string; disabled?: boolean }[],
  allLabel: string
): { value: T | ''; label: string; disabled?: boolean }[] {
  return [{ value: '', label: allLabel }, ...items]
}

/** Record<key, {text}> → 筛选选项，带「全部 xx」 */
export function metaFilterOptions(meta: Record<string, { text: string }>, allLabel: string): { value: string; label: string }[] {
  return filterOptions(Object.entries(meta).map(([value, m]) => ({ value, label: m.text })), allLabel) as { value: string; label: string }[]
}

/** 筛选值 → 请求参数：空串 / 0 当成「不筛」 */
export const orUndef = <T>(v: T | '' | undefined): T | undefined => (v === '' || v === undefined ? undefined : (v as T))
