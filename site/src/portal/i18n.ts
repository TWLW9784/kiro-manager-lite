// 门户的多语言：上次选的 → 浏览器语言 → 英文；切换后存进 localStorage
import { computed, ref } from 'vue'
import { LANGS, MESSAGES, type Lang } from './messages'
import { setErrorTranslator } from '@site/shared/api'

function detect(): Lang {
  const saved = localStorage.getItem('pl.lang')
  if (saved && saved in MESSAGES) return saved as Lang
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('uz')) return 'uz'
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

export const lang = ref<Lang>(detect())

type Key = keyof (typeof MESSAGES)['zh']

/** t('claimed_ok', { n: 3 }) */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = MESSAGES[lang.value] as Record<string, string>
  let text = dict[key] ?? (MESSAGES.zh as Record<string, string>)[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v))
  return text
}

/** 模板里直接用的响应式包装：语言切了会重新渲染 */
export const tt = computed(() => (key: string, params?: Record<string, string | number>) => {
  void lang.value
  return t(key, params)
})

export function setLang(next: Lang): void {
  lang.value = next
  localStorage.setItem('pl.lang', next)
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : next
  document.title = t('title')
}

/** 服务器错误码按当前语言翻译，没有对应文案就用原文 */
setErrorTranslator((code, fallback) => {
  const key = `err_${code}` as Key
  return code && key in MESSAGES.zh ? t(key) : fallback
})

document.documentElement.lang = lang.value === 'zh' ? 'zh-CN' : lang.value
export { LANGS }
export type { Lang }
