// 把导出 / 线下发出去的链接手动分配给网站上的客户（服务端见 admin.php 的 assign_links）
//
// 发出去的链接默认不推到网站（见 paylinksSync 的推送范围）。分配之后这几条按「已领」挂到
// 那个客户名下，网站上跟着付款状态走、计入他的结算；之后的同步照常跟进。
import { useAccountsStore } from '@/stores/accounts'
import { isPaidSubscription, paymentLinkTier } from '@shared/paymentLink'
import type { Account } from '@shared/types'
import { auditEmails, auditExport } from './audit'
import { LINK_STATUS_META, paylinksAdmin, shortLink, type AdminLink, type AssignLinkInput } from './paylinksAdmin'
import { linkCny } from './paymentLinkExtract'
import { paymentLinkBrief } from './paymentLinks'

/**
 * 网站上的链接复制出去时的操作记录：网站只存账号哈希，按链接对回本机账号拿到邮箱；
 * 对不上的（本机已删了这个号）只记链接缩写
 */
export function auditWebsiteLinks(action: string, links: AdminLink[], to?: string): void {
  const byUrl = new Map(
    useAccountsStore()
      .accounts.filter((a) => a.paymentLink)
      .map((a) => [a.paymentLink!.url, a])
  )
  const items = links.map((link) => ({ link, email: byUrl.get(link.url)?.email }))
  auditExport(action, items, {
    to,
    unit: '条支付链接',
    category: 'PaylinksAdmin',
    detail: ({ link }) =>
      [
        link.tier,
        link.amount_due != null ? `今付 $${Number(link.amount_due).toFixed(2)}` : '',
        `网站状态 ${LINK_STATUS_META[link.status]?.text ?? link.status}`,
        link.client ? `客户 ${link.client}` : '',
        shortLink(link.url)
      ]
        .filter(Boolean)
        .join('｜')
  })
}

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
  // 先记再改：记录里要的是分配之前的状态（以前有没有导出给过别人）
  auditExport(`分配给网站客户（批次 ${res.code || '-'}${note ? `，备注 ${note}` : ''}）`, ok, {
    to: `网站客户 ${clientName}`,
    detail: paymentLinkBrief,
    unit: '条支付链接',
    category: 'PaylinksAssign'
  })
  const skipped = list.filter((a) => conflict.has(urlHashes[a.paymentLink!.url]))
  if (skipped.length) {
    auditEmails('warn', 'PaylinksAssign', `${skipped.length} 条没分配给 ${clientName}：网站上已归别的客户或已付款`, skipped.map((a) => a.email))
  }
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
  return { assigned: res.assigned, codes: res.code, conflicts: res.conflicts.length }
}
