// 订阅档位的判定口径：主进程解析接口响应、读取历史数据时对齐档位，都走这里
import type { SubscriptionType } from './types'

/**
 * 从接口返回的订阅标题判定档位。
 *
 * 判断链顺序敏感，必须从最具体往最一般排：
 * - PRO MAX 与 PRO+ 都含子串 "PRO"，两者都必须先于 PRO，否则会被 PRO 抢走
 * - PRO MAX 不含 "PRO+"，PRO+ 也不含 "MAX"，两者互不干扰
 * - POWER 不含 "PRO"，位置不敏感
 *
 * 这里没有 Enterprise：它是登录方式（IdpType），不是订阅档位。
 * POWER 单独成档、不与其它档位合并，Power 账号才能显示自己的档位并单独筛选。
 */
export function normalizeSubscriptionType(title: string): SubscriptionType {
  const t = String(title || '').toUpperCase()
  if (t.includes('PRO MAX') || t.includes('PRO_MAX') || t.includes('PROMAX')) return 'Pro_Max'
  if (t.includes('PRO+') || t.includes('PRO PLUS') || t.includes('PRO_PLUS') || t.includes('PROPLUS')) {
    return 'Pro_Plus'
  }
  if (t.includes('POWER')) return 'Power'
  if (t.includes('TEAMS')) return 'Teams'
  // 学生号：教育邮箱认证后的档位，标题形如 KIRO STUDENT，不含 PRO，位置不敏感
  if (t.includes('STUDENT')) return 'Student'
  if (t.includes('PRO')) return 'Pro'
  return 'Free'
}

/** 当前有效的订阅档位；磁盘上、别的版本导出的文件里可能留着已废弃的值 */
const VALID_TYPES = new Set<string>(['Free', 'Pro', 'Pro_Plus', 'Pro_Max', 'Power', 'Teams', 'Student'] satisfies SubscriptionType[])

/**
 * 订阅档位以 title 为准：type 是从 title 派生的持久化值。
 * 别的版本 / 别的管理器导出的文件里 type 可能和 title 对不上（如 1.7.5 把 KIRO PRO MAX 存成 Pro），
 * 读盘和恢复备份时都按 title 重算。title 缺失时无判据，只把已废弃的档位归到 Free，其余保持原值
 */
export function alignedSubscriptionType(sub: { type: string; title?: string }): SubscriptionType {
  if (sub.title) return normalizeSubscriptionType(sub.title)
  return VALID_TYPES.has(sub.type) ? (sub.type as SubscriptionType) : 'Free'
}
