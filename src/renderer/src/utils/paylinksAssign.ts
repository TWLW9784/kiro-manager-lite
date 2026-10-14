// 把导出 / 线下发出去的链接手动分配给网站上的客户（服务端见 admin.php 的 assign_links）
//
// 发出去的链接默认不推到网站（见 paylinksSync 的推送范围）。分配之后这几条按「已领」挂到
// 那个客户名下，网站上跟着付款状态走、计入他的结算；之后的同步照常跟进。
import { useAccountsStore } from '@/stores/accounts'
import { isPaidSubscription, paymentLinkTier } from '@shared/paymentLink'
import type { Account } from '@shared/types'
import { auditEmails } from './audit'
import { paylinksAdmin, type AssignLinkInput } from './paylinksAdmin'
import { linkCny } from './paymentLinkExtract'

export interface AssignResult {
  assigned: number
  codes: string
  /** 网站上已经归别的客户或已付款、没动的条数 */
  conflicts: number
}

export async function assignLinksToClient(accounts: Account[], clientId: number, clientName: string, note: string): Promise<AssignResult> {
  const store = useAccountsStore()
  const list = accounts.filter((a) => a.paymentLink)
  if (!list.length) throw new Error('选中的账号没有支付链接')
  const hashes = await window.api.paylinksHashes({ accountIds: list.map((a) => a.id), urls: list.map((a) => a.paymentLink!.url) })
  if (!hashes.success || !hashes.data) throw new Error(hashes.error || '计算哈希失败')
  const { accountRefs, urlHashes } = hashes.data

  const links: AssignLinkInput[] = list.map((a) => {
    const link = a.paymentLink!
    return {
      url: link.url,
      account_ref: accountRefs[a.id],
      tier: paymentLinkTier(link),
      amount_due: link.amountDue,
      amount_cny: linkCny(link),
      list_price: link.amount,
      extracted_at: link.createdAt,
      paid: isPaidSubscription(a.subscription.type)
    }
  })
  const res = await paylinksAdmin.assignLinks({ client_id: clientId, note, links })

  // 本地记下归属；网站上冲突（归别人 / 已付）的不记，免得以为分出去了
  const conflict = new Set(res.conflicts.map((c) => c.url_hash))
  const ok = list.filter((a) => !conflict.has(urlHashes[a.paymentLink!.url]))
  store.patchPaymentLinks(
    ok.map((a) => {
      const link = a.paymentLink!
      const paid = isPaidSubscription(a.subscription.type)
      return {
        id: a.id,
        url: link.url,
        patch: {
          assignedClientId: clientId,
          assignedOrderCode: res.code,
          exportedAt: link.exportedAt ?? Date.now(),
          exportedTo: link.exportedTo || clientName,
          syncedHash: urlHashes[link.url],
          serverStatus: paid ? 'paid' : 'claimed'
        }
      }
    })
  )
  auditEmails('info', 'PaylinksAssign', `分配 ${res.assigned} 条链接给网站客户 ${clientName}（批次 ${res.code || '-'}）`, ok.map((a) => a.email))
  return { assigned: res.assigned, codes: res.code, conflicts: res.conflicts.length }
}
