// 共用的格式化与常量
export const num = (v: unknown): number => Number(v ?? 0) || 0
export const usd = (v: unknown): string => `$${num(v).toFixed(2)}`
export const cny = (v: unknown): string => `¥${num(v).toFixed(2)}`
/** 2026-10-14 08:20:36 → 10-14 08:20 */
export const dt = (v?: string | null): string => (v ? String(v).slice(5, 16) : '-')
/** 0x1234…abcd */
export const short = (s?: string | null, head = 8, tail = 6): string =>
  s && s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '-'
/** 支付链接只显示会话号缩写 */
export function shortLink(url: string): string {
  const id = url.match(/cs_(?:live|test)_[A-Za-z0-9]+/)?.[0]
  if (id) return id.length > 22 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id
  return short(url, 28, 8)
}
/** 分钟 → 7 天 / 3 小时 */
export const minutes = (m: number): string =>
  m % 1440 === 0 ? `${m / 1440} 天` : m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`

export const LINK_STATUS: Record<string, { text: string; type: '' | 'success' | 'warning' | 'info' | 'danger' }> = {
  available: { text: '可领取', type: 'info' },
  claimed: { text: '已领待付', type: 'warning' },
  checking: { text: '确认中', type: 'warning' },
  paid: { text: '已付款', type: 'success' },
  refresh: { text: '待换新', type: '' },
  superseded: { text: '已作废', type: '' },
  void: { text: '已作废', type: '' }
}
export const ORDER_STATUS: Record<string, { text: string; type: '' | 'success' | 'warning' | 'info' | 'danger' }> = {
  open: { text: '进行中', type: 'info' },
  done: { text: '已完成', type: 'success' },
  cancelled: { text: '已取消', type: '' }
}
export const SETTLE_STATUS: Record<string, { text: string; type: '' | 'success' | 'warning' | 'info' | 'danger' }> = {
  unsettled: { text: '未结算', type: 'warning' },
  partial: { text: '部分结算', type: 'info' },
  settled: { text: '已结清', type: 'success' },
  prepaid: { text: '已预付', type: 'info' }
}
export const NETWORK_NAMES: Record<string, string> = {
  polygon: 'Polygon',
  ethereum: 'Ethereum',
  bsc: 'BNB Chain',
  arbitrum: 'Arbitrum',
  tron: 'Tron'
}
export const networkName = (id?: string | null): string => NETWORK_NAMES[id ?? ''] ?? (id || '-')
export const validAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address)
export const validTxHash = (hash: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(hash)
/** 收款地址 24 小时内改过 */
export const walletFresh = (updatedAt?: string | null): boolean =>
  !!updatedAt && Date.now() - Date.parse(`${updatedAt.replace(' ', 'T')}+08:00`) < 864e5

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}
