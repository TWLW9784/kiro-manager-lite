// 节流的账号快照：给只需要「差不多实时」的页面用
//
// 后台批量刷新用量时，每刷完一个账号 store 都会整体换一次 accounts 数组（上千个账号就换上千次）。
// 直接依赖 store.accounts 的页面会跟着每次都把全量账号重扫一遍、重渲染一遍，滚动明显发卡。
// 这里把变化合并成每 800ms 最多一次；页面不在前台（active 为 false）时干脆不更新，切回来再补一次。
import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import type { Account } from '@shared/types'

const THROTTLE_MS = 800

export function useThrottledAccounts(active: Ref<boolean>): Ref<Account[]> {
  const store = useAccountsStore()
  const snapshot = shallowRef<Account[]>(store.accounts)
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  const flush = (): void => {
    timer = null
    if (!dirty) return
    dirty = false
    snapshot.value = store.accounts
  }

  watch(
    () => store.accounts,
    () => {
      dirty = true
      if (!active.value || timer) return
      timer = setTimeout(flush, THROTTLE_MS)
    }
  )

  // 切回前台：攒着的变化立刻补上，不等节流
  watch(active, (on) => {
    if (on && dirty) {
      if (timer) clearTimeout(timer)
      flush()
    }
  })

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  return snapshot
}
