// 剪贴板监听：「粘贴文本导入」的连续收集模式用
//
// 用户在微信里逐条右键「复制」，回到本应用前不必每次切窗口粘贴。
// 轮询放在主进程：窗口被微信挡住、失焦后，渲染进程的定时器会被 Chromium 节流到秒级以上，
// 连续复制几条时会漏掉中间的。内容只推给发起监听的那个窗口，不落盘、不进日志。
import { clipboard, type WebContents } from 'electron'

const POLL_MS = 400

let timer: ReturnType<typeof setInterval> | null = null
let target: WebContents | null = null
let last = ''

export function startClipboardWatch(contents: WebContents): void {
  stopClipboardWatch()
  target = contents
  // 开始时剪贴板里已有的内容不算「新复制的」，免得把上一次复制的东西也收进来
  last = clipboard.readText()
  timer = setInterval(() => {
    if (!target || target.isDestroyed()) return stopClipboardWatch()
    const text = clipboard.readText()
    if (!text || text === last) return
    last = text
    target.send('clipboard:changed', text)
  }, POLL_MS)
  // 窗口关掉 / 刷新时自动停，避免定时器一直挂着
  contents.once('destroyed', stopClipboardWatch)
}

export function stopClipboardWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
  target = null
  last = ''
}
