// 门户的共享状态：账号信息与统计（api.php?action=me）
import { computed, ref } from 'vue'
import { api } from '@site/shared/api'
import { t } from './i18n'

export interface Me {
  now: string
  client: {
    username: string
    display_name: string
    wallet_network: string
    wallet_network_name: string
    wallet_network_ok: boolean
    wallet_token: string
    wallet_address: string
    wallet_updated_at: string | null
  }
  timeout_minutes: number
  max_claim: number
  stats: {
    claimed: number
    checking: number
    paid: number
    paid_today: number
    paid_usd: number
    paid_cny: number
    due: number
    profit: number
    settled: number
    unsettled: number
    prepaid: number
    open_orders: number
    claimable: number
  }
  networks: { id: string; name: string; explorer: string }[]
  tokens: string[]
}

export const me = ref<Me | null>(null)

/** 使用说明弹窗：顶栏按钮和工作台的新手提示都能打开 */
export const helpOpen = ref(false)

/**
 * 新手提示是否已关闭。按账号记在本机：同一台电脑换个客户账号登录，
 * 新账号还能看到。
 */
const guideKey = (): string => `pl.guide.${me.value?.client.username ?? ''}`
export const guideDismissed = ref(false)
export function syncGuide(): void {
  guideDismissed.value = !!me.value && localStorage.getItem(guideKey()) === '1'
}
export function dismissGuide(): void {
  localStorage.setItem(guideKey(), '1')
  guideDismissed.value = true
}

export async function loadMe(): Promise<void> {
  me.value = await api.get<Me>('me')
  syncGuide()
}

/** 领取规则说明：N 小时 / N 天 */
export const claimRule = computed(() => {
  const m = me.value?.timeout_minutes ?? 1440
  const time =
    m % 1440 === 0 ? t('days', { n: m / 1440 }) : m % 60 === 0 ? t('hours', { n: m / 60 }) : t('minutes', { n: m })
  return t('claim_rule', { timeout: time })
})

/** 收款地址的问题：没填 / 不是 Polygon */
export const walletIssue = computed<'missing' | 'network' | null>(() => {
  const c = me.value?.client
  if (!c) return null
  if (!c.wallet_address) return 'missing'
  if (!c.wallet_network_ok) return 'network'
  return null
})
