// 操作记录：导入 / 导出 / 复制凭证这类「事后要回查动了哪些号」的操作
//
// 渲染进程的 console 不会进日志中心，必须显式送到主进程。
// 主进程把它们和系统日志放在一起显示，另外按月永久写进 audit-YYYY-MM.log：
// 系统日志几个小时就轮换掉了，「这个号导出过没有、发给了谁」几个月后还要查。
// 一次操作的所有行一次 IPC 送过去，导出上千个号也不会刷几千次 IPC。
import { paymentLinkState, paymentLinkTier } from '@shared/paymentLink'
import type { Account, AccountGroup, KeyEntry, LogLevel } from '@shared/types'
import { IDP_META, PAYMENT_LINK_META, subscriptionLabel } from './format'

const CHUNK = 20

function send(lines: { level: LogLevel; message: string }[]): void {
  if (lines.length) void window.api.writeAuditLog(lines)
}

/** 每行自带级别（导入时失败的记 warn） */
export function auditLines(category: string, lines: { level: LogLevel; text: string }[]): void {
  send(lines.map((line) => ({ level: line.level, message: `[${category}] ${line.text}` })))
}

/** 一条总览，再每 20 个邮箱一条：导入 / 分配这类只需知道「是哪些号」的 */
export function auditEmails(level: LogLevel, category: string, summary: string, emails: string[]): void {
  const lines = [{ level, message: `[${category}] ${summary}` }]
  for (let i = 0; i < emails.length; i += CHUNK) {
    const part = emails.slice(i, i + CHUNK)
    lines.push({ level, message: `[${category}] ${i + 1}-${i + part.length}：${part.join('、')}` })
  }
  send(lines)
}

export interface AuditExportOptions<T> {
  /** 去向：保存的文件路径、网站客户等；不填就是剪贴板 */
  to?: string
  /** 每个对象当时的状态快照（订阅、分组、支付链接档位与金额……），不写凭证 */
  detail?: (item: T) => string
  /** 总览里的补充说明，如「已跳过失效的 3 条」 */
  note?: string
  /** 数量词，默认「个账号」 */
  unit?: string
  category?: string
}

/** 路径只留文件名：逐条记录里写全路径太长，总览里有全路径 */
function fileName(to: string): string {
  return to.split(/[\\/]/).pop() || to
}

/**
 * 导出类操作：一条总览（方式、去向、数量），再每个对象一条（邮箱打头）。
 * 在日志中心搜邮箱，就能看到它在什么时候、以什么方式、发到了哪里，以及当时的状态。
 * 只有一个对象时合成一条
 */
export function auditExport<T extends { email?: string }>(
  action: string,
  items: T[],
  options: AuditExportOptions<T> = {}
): void {
  if (!items.length) return
  const { detail, note, unit = '个账号', category = 'Export' } = options
  const to = options.to || '剪贴板'
  const line = (text: string): { level: LogLevel; message: string } => ({ level: 'info', message: `[${category}] ${text}` })
  const describe = (item: T): string => {
    const extra = detail?.(item)
    return `${item.email || '(无邮箱)'}${extra ? `｜${extra}` : ''}`
  }

  if (items.length === 1) {
    send([line(`${action} → ${to}${note ? `（${note}）` : ''}：${describe(items[0])}`)])
    return
  }
  const shortTo = fileName(to)
  send([
    line(`${action} → ${to}：${items.length} ${unit}${note ? `（${note}）` : ''}`),
    ...items.map((item, i) => line(`${describe(item)}｜${action} → ${shortTo}（第 ${i + 1}/${items.length} 个）`))
  ])
}

/** 账号导出时的状态：登录方式｜订阅｜分组｜支付链接（有的话） */
export function accountBrief(account: Account, groups?: AccountGroup[]): string {
  const parts = [IDP_META[account.idp]?.text ?? account.idp, subscriptionLabel(account.subscription)]
  if (groups) {
    const group = account.groupId ? groups.find((g) => g.id === account.groupId)?.name : ''
    parts.push(group ? `分组 ${group}` : '未分组')
  }
  if (account.paymentLink) {
    parts.push(`支付链接 ${paymentLinkTier(account.paymentLink)} ${PAYMENT_LINK_META[paymentLinkState(account)].text}`)
  }
  return parts.join('｜')
}

/** API Key 只记前后几位，足够和列表对上，记下来的不能直接拿去用 */
export function keyBrief(entry: Pick<KeyEntry, 'key'> & Partial<Pick<KeyEntry, 'subscription' | 'region'>>): string {
  const key = entry.key ? `${entry.key.slice(0, 8)}…${entry.key.slice(-4)}` : '-'
  return [key, entry.subscription, entry.region].filter(Boolean).join('｜')
}
