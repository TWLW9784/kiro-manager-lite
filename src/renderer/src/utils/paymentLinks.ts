// 支付链接的导出与复制：新订阅管理页的两个面板共用
//
// 对外格式固定以「邮箱 订阅等级 支付链接」打头（订阅等级为 pro / pro+ / promax / power），
// Excel 前三列与复制出来的每一行都是这个顺序，其余信息排在后面。
import { isAwaitingKiroSync, paymentLinkState, paymentLinkTier } from '@shared/paymentLink'
import type { Account, AccountGroup, XlsxSheet } from '@shared/types'
import { PAYMENT_LINK_META, formatFullDateTime, formatLocal, formatPrice, formatUsd, subscriptionLabel } from './format'
import { exportStamp } from './transfer'
import { linkCny } from './paymentLinkExtract'
import { shortLink } from './paylinksAdmin'

/** 付款状态文案：Stripe 已付、Kiro 还没同步的单独标出来 */
export function paymentStateText(account: Account, nowMs = Date.now()): string {
  if (isAwaitingKiroSync(account)) return '已付款（Kiro 待同步）'
  return PAYMENT_LINK_META[paymentLinkState(account, nowMs)].text
}

/** 今天应付文案：查到了显示实付（USD），没查到退回标价并注明 */
export function amountDueText(link: NonNullable<Account['paymentLink']>): string {
  if (link.amountDue === undefined) return `${formatPrice(link.amount, link.currency)}（标价）`
  return `今付 ${formatUsd(link.amountDue)}`
}

/** 今天应付对应的人民币（如 ¥34.31）；没有金额时返回空串 */
export function localDueText(link: NonNullable<Account['paymentLink']>): string {
  const cny = linkCny(link)
  return cny === undefined ? '' : formatLocal(cny, 'CNY')
}

/**
 * 操作记录里一条支付链接当时的状态：档位｜应付｜付款状态｜提取时间｜会话号缩写｜以前发给过谁。
 * 链接只记缩写（cs_live_a1b2…z9），够和 Excel / 网站上的对上，整条太长
 */
export function paymentLinkBrief(account: Account): string {
  const link = account.paymentLink
  if (!link) return '没有支付链接'
  const cny = localDueText(link)
  const parts = [
    paymentLinkTier(link),
    `${amountDueText(link)}${cny ? `（${cny}）` : ''}`,
    paymentStateText(account),
    `提取于 ${formatFullDateTime(link.createdAt)}`,
    shortLink(link.url)
  ]
  if (link.assignedOrderCode) parts.push(`已在网站批次 ${link.assignedOrderCode}`)
  else if (link.exportedAt) parts.push(`此前 ${formatFullDateTime(link.exportedAt)} 已发出${link.exportedTo ? `给 ${link.exportedTo}` : ''}`)
  return parts.join('｜')
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
        linkCny(link) ?? null,
        link.credit ?? null,
        link.subtotal ?? null,
        link.amount,
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
      { title: '今天应付(USD)', width: 13, format: 'number', decimals: 2 },
      { title: '今天应付(CNY)', width: 13, format: 'number', decimals: 2 },
      { title: '新用户抵扣(USD)', width: 15, format: 'number', decimals: 2 },
      { title: '首期金额(USD)', width: 13, format: 'number', decimals: 2 },
      { title: '月费标价(USD)', width: 13, format: 'number', decimals: 2 },
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

// ============ 代付 TXT ============

/** 两位补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 表头里的导出时间：2026/10/7 02:48:30（日期不补零、时间补零，与手工整理的文件一致） */
function txtStamp(date: Date): string {
  const ymd = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export interface PaymentLinkTxtOptions {
  /** 发给谁，写在表头，也进文件名 */
  recipient: string
  /** 加一行档位与应付金额合计，方便对方核对 */
  includeAmount?: boolean
  /** 每行链接后附上邮箱与档位（给自己留档用；发给代付的人一般不需要） */
  includeEmail?: boolean
  date?: Date
}

/**
 * 代付用的纯文本：表头两行说明，空一行，然后「序号. 链接」一行一条。
 * 整段发给代付的人，对方按序号逐个打开付款即可。
 */
export function buildPaymentLinkTxt(accounts: Account[], options: PaymentLinkTxtOptions): string {
  const list = accounts.filter((a) => a.paymentLink)
  const date = options.date ?? new Date()
  const recipient = options.recipient.trim()

  const header = [
    `# 代付付款链接　${recipient ? `发给：${recipient}　` : ''}共 ${list.length} 条　导出于 ${txtStamp(date)}`,
    '# 每条前面是序号，一行一个链接；整段发给对方，对方按序号逐个打开付款即可。'
  ]

  if (options.includeAmount) {
    // 档位与金额按出现的种类归并：同一批多数是同一档位，罗列每条反而啰嗦
    const tiers = [...new Set(list.map((a) => paymentLinkTier(a.paymentLink!)))]
    const due = list.reduce((sum, a) => sum + (a.paymentLink!.amountDue ?? 0), 0)
    const unknown = list.filter((a) => a.paymentLink!.amountDue === undefined).length
    // 人民币只在每条都有金额时才合计，缺一条就不写，免得给出一个偏低的数
    const cnys = list.map((a) => linkCny(a.paymentLink!))
    const cny = cnys.every((v) => v !== undefined)
      ? cnys.reduce((sum: number, v) => sum + v!, 0)
      : undefined
    header.push(
      `# 档位：${tiers.join(' / ') || '-'}　合计应付：${formatUsd(due)}${
        cny !== undefined ? `（≈ ${formatLocal(cny, 'CNY')}）` : ''
      }${unknown ? `（其中 ${unknown} 条未查到金额，未计入）` : ''}`
    )
  }

  const lines = list.map((account, index) => {
    const link = account.paymentLink!
    const suffix = options.includeEmail ? `　${account.email}　${paymentLinkTier(link)}` : ''
    return `${index + 1}. ${link.url}${suffix}`
  })

  return `${header.join('\n')}\n\n${lines.join('\n')}\n`
}

/** 文件名：代付链接_迅速_共10条_20261007_0248.txt */
export function paymentLinkTxtFilename(recipient: string, count: number, date = new Date()): string {
  const name = recipient.trim().replace(/[\\/:*?"<>|\s]+/g, '') || '代付'
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return `代付链接_${name}_共${count}条_${ymd}_${pad(date.getHours())}${pad(date.getMinutes())}.txt`
}

/** 复制出来的就是链接本身，一行一个；邮箱与档位要带的话走导出（Excel / 代付 TXT 的「附邮箱」） */
export function paymentLinkText(accounts: Account[]): string {
  return accounts
    .filter((a) => a.paymentLink)
    .map((a) => a.paymentLink!.url)
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
