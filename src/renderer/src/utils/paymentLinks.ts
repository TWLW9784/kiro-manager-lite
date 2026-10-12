// 支付链接的导出与复制：新订阅管理页的两个面板共用
//
// 对外格式固定以「邮箱 订阅等级 支付链接」打头（订阅等级为 pro / pro+ / promax / power），
// Excel 前三列与复制出来的每一行都是这个顺序，其余信息排在后面。
import { isPaymentLinkStale, paymentLinkState, paymentLinkTier } from '@shared/paymentLink'
import type { Account, AccountGroup, XlsxSheet } from '@shared/types'
import { PAYMENT_LINK_META, formatPrice, subscriptionLabel } from './format'
import { exportStamp } from './transfer'

/** 付款状态文案：待付款且超过 24 小时的额外标注可能过期 */
export function paymentStateText(account: Account, nowMs = Date.now()): string {
  const state = paymentLinkState(account)
  const text = PAYMENT_LINK_META[state].text
  const link = account.paymentLink
  return state === 'pending' && link && isPaymentLinkStale(link, nowMs) ? `${text}（可能已过期）` : text
}

/** 实付金额文案：查到了显示实付，没查到退回标价并注明 */
export function amountDueText(link: NonNullable<Account['paymentLink']>): string {
  if (link.amountDue === undefined) return `${formatPrice(link.amount, link.currency)}（标价）`
  return link.amountDue <= 0 ? '$0' : formatPrice(link.amountDue, link.currency)
}

/**
 * 支付链接表：一行一个账号。数值列写原始值（金额、时间戳），
 * 在 Excel 里还能按金额求和、按时间排序；链接写纯文本，
 * 不用 HYPERLINK 公式——Stripe 结算链接常超过公式参数的 255 字符上限。
 */
export function buildPaymentLinkSheet(accounts: Account[], groups: AccountGroup[]): XlsxSheet {
  const groupName = new Map(groups.map((g) => [g.id, g.name]))
  const nowMs = Date.now()
  const rows = accounts
    .filter((a) => a.paymentLink)
    .map((account) => {
      const link = account.paymentLink!
      return [
        account.email,
        paymentLinkTier(link),
        link.url,
        link.amountDue ?? null,
        link.amount,
        link.currency,
        link.createdAt,
        paymentStateText(account, nowMs),
        subscriptionLabel(account.subscription),
        account.lastCheckedAt ?? null,
        account.nickname || '',
        account.note || '',
        (account.groupId && groupName.get(account.groupId)) || ''
      ]
    })

  return {
    name: '支付链接',
    columns: [
      { title: '邮箱', width: 32 },
      { title: '订阅等级', width: 10 },
      { title: '支付链接', width: 80 },
      { title: '实付金额', width: 10, format: 'number', decimals: 2 },
      { title: '标价', width: 9, format: 'number', decimals: 2 },
      { title: '币种', width: 7 },
      { title: '提取时间', width: 20, format: 'datetime' },
      { title: '付款状态', width: 16 },
      { title: '当前订阅', width: 14 },
      { title: '状态更新时间', width: 20, format: 'datetime' },
      { title: '昵称', width: 14 },
      { title: '备注', width: 18 },
      { title: '分组', width: 12 }
    ],
    rows
  }
}

export function paymentLinkFilename(): string {
  return `kiro-payment-links-${exportStamp()}.xlsx`
}

/**
 * 复制格式：
 * - full：每行「邮箱 订阅等级 支付链接」，空格分隔（三段本身都不含空格）
 * - url：只有链接，一行一个
 */
export function paymentLinkText(accounts: Account[], format: 'full' | 'url'): string {
  return accounts
    .filter((a) => a.paymentLink)
    .map((a) => {
      const link = a.paymentLink!
      return format === 'url' ? link.url : `${a.email} ${paymentLinkTier(link)} ${link.url}`
    })
    .join('\n')
}

/** 隐私模式下链接只露出域名，正常模式完整显示（由样式负责截断） */
export function displayPaymentUrl(url: string, privacy: boolean): string {
  if (!privacy) return url
  try {
    return `${new URL(url).host}/••••••`
  } catch {
    return '••••••'
  }
}
