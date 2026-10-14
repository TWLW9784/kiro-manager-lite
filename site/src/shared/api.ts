// 网站接口封装：客户门户与网页后台共用。后端见 server/paylinks/api.php
import { ElMessage } from 'element-plus'

/** 页面上 <div id="app" data-csrf="..."> 带过来的 CSRF token */
export const CSRF = document.getElementById('app')?.dataset.csrf ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = ''
  ) {
    super(message)
  }
}

/** 服务器错误码 → 本地化文案，由各端注入（门户用 i18n，后台用中文原文） */
let translateError: (code: string, fallback: string) => string = (_c, f) => f

export function setErrorTranslator(fn: (code: string, fallback: string) => string): void {
  translateError = fn
}

async function request(url: string, init: RequestInit = {}): Promise<Record<string, any>> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError(translateError('network_error', '网络错误，请重试'), 'network_error')
  }
  // 401：登录过期，刷新回登录页
  if (res.status === 401) {
    location.reload()
    throw new ApiError('login required', 'login_required')
  }
  const data = (await res.json().catch(() => ({ ok: false }))) as Record<string, any>
  if (!data.ok) {
    const code = String(data.code ?? '')
    throw new ApiError(translateError(code, String(data.error ?? '请求失败')), code)
  }
  return data
}

const query = (action: string, params: Record<string, unknown> = {}): string => {
  const q = new URLSearchParams({ action })
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  }
  return `api.php?${q}`
}

export const api = {
  get: <T = Record<string, any>>(action: string, params?: Record<string, unknown>) =>
    request(query(action, params), { headers: { 'X-CSRF-Token': CSRF } }) as Promise<T>,
  post: <T = Record<string, any>>(action: string, body?: unknown) =>
    request(`api.php?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify(body ?? {})
    }) as Promise<T>,
  form: <T = Record<string, any>>(action: string, data: FormData) =>
    request(`api.php?action=${action}`, { method: 'POST', headers: { 'X-CSRF-Token': CSRF }, body: data }) as Promise<T>,
  /** 管理接口：POST ?action=admin {op, ...} */
  admin: <T = Record<string, any>>(op: string, body: Record<string, unknown> = {}) =>
    request('api.php?action=admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ op, ...body })
    }) as Promise<T>
}

/** 包一层：出错弹提示，不抛出去中断渲染 */
export async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiError && e.code === 'login_required') return
    ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}
