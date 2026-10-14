// 代付链接网站同步：请求在主进程发，走应用的代理设置，也不受渲染进程跨域限制
import { createHash, randomBytes } from 'crypto'
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

/** 记一笔结算（打款）：multipart，可带凭证文件。字段见 server/paylinks/inc/settle.php */
export async function paylinksSettlementAdd(
  serverUrl: string,
  token: string,
  fields: Record<string, string>,
  proof?: { name: string; type: string; data: Uint8Array }
): Promise<Record<string, unknown>> {
  const { base, auth } = endpoint(serverUrl, token)
  const boundary = `----kml${randomBytes(12).toString('hex')}`
  const CRLF = '\r\n'
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`))
  }
  if (proof) {
    const name = proof.name.replace(/["\r\n]/g, '_')
    const type = proof.type || 'application/octet-stream'
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="proof"; filename="${name}"${CRLF}Content-Type: ${type}${CRLF}${CRLF}`))
    parts.push(Buffer.from(proof.data))
    parts.push(Buffer.from(CRLF))
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`))
  const res = await httpRequest(`${base}/api.php?action=settlement_add`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: auth },
    body: Buffer.concat(parts),
    timeoutMs: 60_000
  })
  return parseResult(res.status, res.ok, await res.text())
}

/** 取付款凭证的原始文件（图片 / PDF） */
export async function paylinksProof(serverUrl: string, token: string, id: number): Promise<{ type: string; data: Buffer }> {
  const { base, auth } = endpoint(serverUrl, token)
  const res = await httpRequest(`${base}/api.php?action=proof&id=${encodeURIComponent(String(id))}`, {
    headers: { authorization: auth },
    timeoutMs: 30_000
  })
  const type = res.headers.get('content-type') || ''
  if (!res.ok || type.includes('json')) {
    const text = await res.text()
    parseResult(res.status, false, text)
  }
  return { type, data: Buffer.from(await res.arrayBuffer()) }
}

function endpoint(serverUrl: string, token: string): { base: string; auth: string } {
  const base = serverUrl.trim().replace(/\/+$/, '')
  if (!/^https:\/\//i.test(base)) throw new Error('网站地址必须以 https:// 开头')
  if (!token.trim()) throw new Error('缺少同步密钥')
  return { base, auth: `Bearer ${token.trim()}` }
}

function parseResult(status: number, httpOk: boolean, text: string): Record<string, unknown> {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`网站返回无法解析：HTTP ${status}`)
  }
  if (!httpOk || !data.ok) throw new Error(String(data.error || `HTTP ${status}`))
  return data
}

async function paylinksCall(
  action: 'sync' | 'admin',
  serverUrl: string,
  token: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const { base, auth } = endpoint(serverUrl, token)
  const res = await httpRequest(`${base}/api.php?action=${action}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body ?? {}),
    timeoutMs: 30_000
  })
  return parseResult(res.status, res.ok, await res.text())
}
