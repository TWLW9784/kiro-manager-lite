import { onUnmounted, readonly, ref } from 'vue'

/** 侧栏从这个宽度起常驻显示，和 layout.css 的媒体查询保持一致 */
export const SIDEBAR_BREAKPOINT = 1080

const width = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
let watchers = 0
let timer: number | undefined

function onResize(): void {
  // 手机转屏会连续触发，节流一下
  window.clearTimeout(timer)
  timer = window.setTimeout(() => (width.value = window.innerWidth), 100)
}

/**
 * 当前视口宽度（响应式）。
 *
 * 抽屉和弹窗的尺寸只能通过 prop 给，Element Plus 会写成行内样式，
 * 用 CSS 盖要加 !important，所以这里按视口算好再传进去。
 */
export function useViewport(): { width: Readonly<typeof width> } {
  if (typeof window !== 'undefined' && watchers++ === 0) {
    window.addEventListener('resize', onResize, { passive: true })
  }
  onUnmounted(() => {
    if (typeof window !== 'undefined' && --watchers === 0) {
      window.removeEventListener('resize', onResize)
      window.clearTimeout(timer)
    }
  })
  return { width: readonly(width) as Readonly<typeof width> }
}

/**
 * 抽屉宽度：窄屏整屏铺开，否则用设计宽度。
 * 不处理的话 760px 的抽屉在 360px 手机上会定位到 left:-400px，
 * 左边 400px 的内容跑到屏幕外且没法滚过去。
 */
export function drawerSize(vw: number, preferred: number): string {
  if (vw <= 640) return '100%'
  if (vw < preferred + 48) return 'calc(100% - 24px)'
  return preferred + 'px'
}

/** 弹窗宽度：窄屏留出边距，否则用设计宽度 */
export function dialogWidth(vw: number, preferred: number): string {
  if (vw < preferred + 48) return 'calc(100vw - 24px)'
  return preferred + 'px'
}

/**
 * 弹窗离顶部的距离。Element Plus 默认 15vh，手机上白白空出 120 多像素，
 * 长一点的弹窗（使用说明、记一笔打款）底部按钮就被挤到屏幕外了。
 */
export function dialogTop(vw: number): string {
  return vw <= 640 ? '12px' : '8vh'
}
