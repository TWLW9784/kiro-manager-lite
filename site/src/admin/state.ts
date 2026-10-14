// 后台共享状态：客户列表与总览
import { computed, ref } from 'vue'
import { api } from '@site/shared/api'

export interface AdminClient {
  id: number
  username: string
  display_name: string
  enabled: number
  max_claim: number
  claim_timeout_minutes: number
  note: string
  last_login_at: string | null
  wallet_network: string
  wallet_token: string
  wallet_address: string
  wallet_updated_at: string | null
  unit_price: string | null
  claimed: string | null
  paid: string | null
  paid_today: string | null
  paid_usd: string | null
  due: number
  client_paid: number
  client_profit: number
  settled: number
  balance: number
  prepaid: number
  unsettled: number
}

export interface AdminOrder {
  id: number
  code: string
  client_id: number
  client: string | null
  tier: string
  quantity: number
  replace_limit: number
  replaced: number
  status: string
  source: string
  note: string
  created_at: string
  settle_status: string
  settled_amount: string
  settle_note: string
  unit_price: string | null
  due_amount: string
  client_profit: string
  paid: string | null
  holding: string | null
  void: string | null
  paid_usd: string | null
  paid_cny: string | null
  settlements: string | null
  wallet_network: string | null
  wallet_token: string | null
  wallet_address: string | null
  wallet_updated_at: string | null
}

export interface Overview {
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

export const clients = ref<AdminClient[]>([])
export const overview = ref<Overview | null>(null)

export async function loadClients(): Promise<void> {
  clients.value = (await api.admin<{ clients: AdminClient[] }>('clients')).clients
}
export async function loadOverview(): Promise<void> {
  overview.value = await api.admin<Overview>('overview')
}

/** 筛选下拉的客户项，第一项是「全部客户」 */
export const clientOptions = computed(() => [
  { value: '' as number | '', label: '全部客户' },
  ...clients.value.map((c) => ({ value: c.id as number | '', label: c.display_name || c.username }))
])

/**
 * 给「全部 xx」用空串当值的筛选下拉用：:empty-values="FILTER_EMPTY"。
 * Element Plus 默认把 ''、undefined、null 都当成「没选」，于是明明选中了「全部客户」
 * 却显示英文 placeholder「Select」。只把 null / undefined 当成没选，空串就能正常显示。
 * 只给筛选用：表单里靠空串显示「请选择」提示的下拉不要加。
 */
export const FILTER_EMPTY = [null, undefined]

/** 桌面端多久没同步了（分钟）；null = 从没同步过 */
export const desktopAgo = computed(() => {
  const o = overview.value
  if (!o?.desktop) return null
  return Math.round((Date.parse(o.now.replace(' ', 'T')) - Date.parse(o.desktop.at.replace(' ', 'T'))) / 60000)
})
