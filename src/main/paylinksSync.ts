// 代付链接网站同步：请求在主进程发，走应用的代理设置，也不受渲染进程跨域限制
import { createHash } from 'crypto'
import { httpRequest } from './net'

/** 账号 id → 网站上的 account_ref；网站只存哈希，看不出是哪个号 */
export function accountRef(accountId: string): string {
  return createHash('sha256').update(`kml-paylinks:${accountId}`).digest('hex')
}

export function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

export function paylinksSync(serverUrl: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  return paylinksCall('sync', serverUrl, token, body)
}

/** 管理接口：客户账号增删改、总览、链接明细、收回（同样用同步密钥认证） */
export function paylinksAdmin(serverUrl: string, token: string, body: unknown): Promise<Record<string, unknown>> {
  return paylinksCall('admin', serverUrl, token, body)
}

async function paylinksCall(
  action: 'sync' | 'admin',
  serverUrl: string,
  token: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const base = serverUrl.trim().replace(/\/+$/, '')
  if (!/^https:\/\//i.test(base)) throw new Error('网站地址必须以 https:// 开头')
  if (!token.trim()) throw new Error('缺少同步密钥')
  const res = await httpRequest(`${base}/api.php?action=${action}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token.trim()}`
    },
    body: JSON.stringify(body ?? {}),
    timeoutMs: 30_000
  })
  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`网站返回无法解析：HTTP ${res.status}`)
  }
  if (!res.ok || !data.ok) throw new Error(String(data.error || `HTTP ${res.status}`))
  return data
}
