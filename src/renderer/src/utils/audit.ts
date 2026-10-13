// 操作日志：导入 / 导出 / 复制凭证这类「事后要回查动了哪些号」的操作，写进系统日志
//
// 渲染进程的 console 不会进日志中心，必须显式送到主进程。
// 格式与主进程的 auditEmails 一致：一条总览，再每 20 个邮箱一条，在系统日志里搜邮箱就能找到。
import type { LogLevel } from '@shared/types'

const CHUNK = 20

export function auditEmails(level: LogLevel, category: string, summary: string, emails: string[]): void {
  const write = (text: string): void => void window.api.writeLog(level, `[${category}] ${text}`)
  write(summary)
  for (let i = 0; i < emails.length; i += CHUNK) {
    const part = emails.slice(i, i + CHUNK)
    write(`${i + 1}-${i + part.length}：${part.join('、')}`)
  }
}

/** 导出类操作统一走这里：分类 Export，总览里写明方式与条数 */
export function auditExport(what: string, emails: string[]): void {
  auditEmails('info', 'Export', `${what}：${emails.length} 个账号`, emails)
}
