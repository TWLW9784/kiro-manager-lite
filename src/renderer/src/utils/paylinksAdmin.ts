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
}

export interface AdminLink {
  id: number
  url_hash: string
  account_ref: string
  url: string
  tier: string
  amount_due: string | null
  amount_cny: string | null
  status: 'available' | 'claimed' | 'checking' | 'paid' | 'refresh'
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
}

/** 网站上链接状态的中文名与颜色 */
export const LINK_STATUS_META: Record<AdminLink['status'], { text: string; color: string }> = {
  available: { text: '可领取', color: 'blue' },
  claimed: { text: '已领待付', color: 'orange' },
  checking: { text: '确认付款中', color: 'gold' },
  paid: { text: '已付款', color: 'green' },
  refresh: { text: '待换新', color: 'default' }
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
    page?: number
    page_size?: number
  }) => call<{ total: number; links: AdminLink[] }>({ op: 'links', ...filter }),
  revokeLinks: (ids: number[]) => call<{ revoked: number }>({ op: 'link_revoke', ids }),
  orders: (filter: { client_id?: number; status?: string } = {}) =>
    call<{ orders: AdminOrder[] }>({ op: 'orders', ...filter }).then((r) => r.orders),
  createOrder: (input: { client_id: number; tier: string; quantity: number; replace_limit?: number; note?: string }) =>
    call<{ id: number; code: string }>({ op: 'order_create', ...input }),
  updateOrder: (input: { id: number; quantity?: number; replace_limit?: number; status?: 'cancelled' }) =>
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
  note: string
  created_at: string
  done_at: string | null
  paid: string | null
  holding: string | null
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
