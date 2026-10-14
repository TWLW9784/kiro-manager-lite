// 管理后台网页：总览 / 派单 / 客户 / 链接。接口与桌面端「网站管理」同一套（?action=admin，{op}）
const csrf = document.querySelector('.app').dataset.csrf
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const num = (v) => Number(v ?? 0)
const money = (v, sym) => `${sym}${num(v).toFixed(2)}`
const short = (v) => (v ? String(v).slice(5, 16) : '-')

async function adm(op, body = {}) {
  const res = await fetch('api.php?action=admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ op, ...body }),
    credentials: 'same-origin'
  })
  if (res.status === 401) location.reload()
  const data = await res.json().catch(() => ({ ok: false, error: '服务器返回异常' }))
  if (!data.ok) throw new Error(data.error || '操作失败')
  return data
}

function toast(text) {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => el.classList.remove('show'), 2400)
}

async function guard(fn) {
  try {
    await fn()
  } catch (e) {
    toast(e.message)
  }
}

// ============ 标签页 ============
let current = 'overview'
const loaders = {}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab')
  if (!btn) return
  current = btn.dataset.tab
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b === btn)
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `tab-${current}`
  guard(loaders[current])
})
$('logout').addEventListener('click', async () => {
  await fetch('api.php?action=admin_logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
})

// ============ 总览 ============
const STATUS = { available: '可领取', claimed: '已领待付', checking: '确认中', paid: '已付款', refresh: '待换新' }
loaders.overview = async () => {
  const o = await adm('overview')
  const tot = {}
  for (const r of o.by_status) {
    const s = (tot[r.status] ??= { n: 0, usd: 0, cny: 0 })
    s.n += num(r.n); s.usd += num(r.usd); s.cny += num(r.cny)
  }
  const days = {}
  const perClient = {}
  for (const d of o.daily) {
    days[d.day] = (days[d.day] || 0) + num(d.n)
    const c = (perClient[d.client || '-'] ??= { n: 0, usd: 0, cny: 0, byDay: {} })
    c.n += num(d.n); c.usd += num(d.usd); c.cny += num(d.cny); c.byDay[d.day] = num(d.n)
  }
  const today = (o.now || '').slice(0, 10)
  // 桌面端心跳：超过 10 分钟没同步就标红（补货、换新、确认付款都靠它）
  const ds = o.desktop
  const ago = ds ? Math.round((Date.parse(o.now.replace(' ', 'T')) - Date.parse(ds.at.replace(' ', 'T'))) / 60000) : null
  const alive = ago !== null && ago <= 10
  const desktopCard = `<div class="card ${alive ? '' : 'alert'}">
    <b>${alive ? '桌面端在线' : '桌面端离线'}</b>
    <span class="small muted">${ds ? `最后同步 ${short(ds.at)}（${ago} 分钟前）${ds.version ? ` · v${esc(ds.version)}` : ''}` : '还没有收到过桌面端同步（旧版本不上报）'}</span>
    ${ds?.last_error ? `<div class="small error">上一轮出错：${esc(ds.last_error)}</div>` : ''}
    ${ds?.last_summary ? `<div class="small muted">上一轮：${esc(ds.last_summary)}</div>` : ''}
    ${alive ? '' : '<div class="small">桌面端没开时：池子不会补货，超时放回的不会换新，确认中的不会定性。</div>'}
  </div>`
  const stuck = num(o.stuck_checking)
    ? `<div class="card alert"><b>${o.stuck_checking} 条确认中超过 30 分钟</b>
        <span class="small">桌面端开着还卡住的话，可能对应账号已不在桌面端。到「链接」页筛选「确认中」手动定性。</span>
        <button class="btn small-btn" data-goto-checking>去处理</button></div>`
    : ''
  const dayKeys = Object.keys(days).sort().reverse()
  $('tab-overview').innerHTML = `${desktopCard}${stuck}
    <div class="grid4">${Object.entries(STATUS).map(([k, label]) => `
      <div class="card stat ${k === 'paid' ? 'ok' : k === 'claimed' ? 'warn' : ''}">
        <b>${tot[k]?.n ?? 0}</b><span>${label}</span>
        <span class="small muted">${money(tot[k]?.usd, '$')} · ${money(tot[k]?.cny, '¥')}</span>
      </div>`).join('')}
      <div class="card stat ok"><b>${days[today] || 0}</b><span>今日已付</span>
        <span class="small muted">Stripe 检查 ${o.last_stripe_check ? o.last_stripe_check.slice(11) : '-'}</span></div>
    </div>
    <div class="card"><h2>近 14 天已付款</h2>
      ${dayKeys.length ? `<div class="table-wrap"><table class="mini">
        <thead><tr><th>客户</th><th>合计</th>${dayKeys.map((d) => `<th>${d.slice(5)}</th>`).join('')}</tr></thead>
        <tbody>${Object.entries(perClient).map(([name, c]) => `<tr><td>${esc(name)}</td>
          <td><b class="ok">${c.n}</b><div class="small muted">${money(c.usd, '$')} · ${money(c.cny, '¥')}</div></td>
          ${dayKeys.map((d) => `<td>${c.byDay[d] ?? ''}</td>`).join('')}</tr>`).join('')}
          <tr><td>全部</td><td><b>${Object.values(perClient).reduce((s, c) => s + c.n, 0)}</b></td>${dayKeys.map((d) => `<td><b>${days[d]}</b></td>`).join('')}</tr>
        </tbody></table></div>` : '<span class="muted">暂无</span>'}
    </div>
    <p class="muted small">池子不够时，开着的桌面端会按派单缺口自动提取；桌面端关着时只能领现有的。</p>`
}
$('tab-overview').addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-checking]')) openLinks({ statuses: ['checking'] })
})
// ============ 派单 ============
let clientsCache = []
async function loadClients() {
  clientsCache = (await adm('clients')).clients
  return clientsCache
}
const clientOptions = (sel) => clientsCache
  .map((c) => `<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''} ${c.enabled ? '' : 'disabled'}>${esc(c.display_name || c.username)}</option>`)
  .join('')
const TIERS = ['pro', 'pro+', 'promax', 'power']

loaders.orders = async () => {
  if (!clientsCache.length) await loadClients()
  const orders = (await adm('orders', {})).orders
  $('tab-orders').innerHTML = `
    <form class="card form" id="order-form">
      <label>客户<select name="client_id" required>${clientOptions()}</select></label>
      <label>档位<select name="tier">${TIERS.map((t) => `<option ${t === 'pro+' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>数量<input name="quantity" type="number" min="1" max="500" value="10" required></label>
      <label>可更换次数<input name="replace_limit" type="number" min="0" max="1000" placeholder="默认=数量"></label>
      <label>备注<input name="note" maxlength="255"></label>
      <button class="btn primary">派单</button>
    </form>
    <div class="list">${orders.map((o) => {
      const pct = Math.round((num(o.paid) / Math.max(1, o.quantity)) * 100)
      return `<div class="item">
        <div class="item-head"><b>${esc(o.code)}</b><span class="pill ${o.status}">${{ open: '进行中', done: '已完成', cancelled: '已取消' }[o.status]}</span>
          <span>${esc(o.client || '-')}</span><span class="pill">${esc(o.tier)} × ${o.quantity}</span><span class="spacer"></span>
          <span class="small muted">${short(o.created_at)}</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="small">已付 <b class="ok">${num(o.paid)}</b> / ${o.quantity} · 待付 ${num(o.holding)} · 更换 ${o.replaced}/${o.replace_limit}
          · ${money(o.paid_usd, '$')} · ${money(o.paid_cny, '¥')}${o.note ? ` · ${esc(o.note)}` : ''}</div>
        <div class="row-actions">
          <button class="btn small-btn" data-links="${o.id}">查看链接</button>
          ${o.status === 'open' ? `<button class="btn small-btn" data-qty="${o.id}" data-cur="${o.quantity}" data-min="${num(o.paid) + num(o.holding)}">改数量</button>
          <button class="btn small-btn" data-limit="${o.id}" data-cur="${o.replace_limit}">改更换次数</button>
          <button class="btn small-btn danger" data-cancel="${o.id}" data-code="${esc(o.code)}">取消批次</button>` : ''}
        </div></div>`
    }).join('') || '<p class="muted">还没有批次</p>'}</div>`
}

$('tab-orders').addEventListener('submit', (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  guard(async () => {
    const body = { client_id: Number(f.get('client_id')), tier: f.get('tier'), quantity: Number(f.get('quantity')), note: f.get('note') }
    if (f.get('replace_limit') !== '') body.replace_limit = Number(f.get('replace_limit'))
    const r = await adm('order_create', body)
    toast(`已派单 ${r.code}`)
    await loaders.orders()
  })
})

$('tab-orders').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.links) return openLinks({ order_id: Number(b.dataset.links) })
  if (b.dataset.qty) {
    const v = prompt(`批次数量（已付 + 待付 ${b.dataset.min} 条，不能少于这个数）`, b.dataset.cur)
    if (v === null) return
    if (!(Number(v) >= Math.max(1, num(b.dataset.min)))) return toast(`数量不能少于 ${Math.max(1, num(b.dataset.min))}`)
    return guard(async () => { await adm('order_update', { id: Number(b.dataset.qty), quantity: Number(v) }); toast('已修改'); await loaders.orders() })
  }
  if (b.dataset.limit) {
    const v = prompt('可更换次数', b.dataset.cur)
    if (v === null) return
    return guard(async () => { await adm('order_update', { id: Number(b.dataset.limit), replace_limit: Number(v) }); await loaders.orders() })
  }
  if (b.dataset.cancel && confirm(`取消批次 ${b.dataset.code}？客户手里没付的会收回换新，已付的照常结算。`)) {
    guard(async () => { await adm('order_update', { id: Number(b.dataset.cancel), status: 'cancelled' }); toast('已取消'); await loaders.orders() })
  }
})
// ============ 客户 ============
function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join('')
}

function clientForm(c) {
  return `<form class="card form" id="client-form" data-id="${c?.id ?? ''}">
    <label>登录账号<input name="username" value="${esc(c?.username ?? '')}" pattern="[A-Za-z0-9_.\\-]{3,32}" required></label>
    <label>显示名称<input name="display_name" value="${esc(c?.display_name ?? '')}" maxlength="64"></label>
    <label>${c ? '新密码（留空不改）' : '密码'}<input name="password" value="${c ? '' : randomPassword()}" minlength="8" ${c ? '' : 'required'}></label>
    <label>领取时限（分钟）<input name="claim_timeout_minutes" type="number" min="10" value="${c?.claim_timeout_minutes ?? 180}"></label>
    <label>备注<input name="note" value="${esc(c?.note ?? '')}" maxlength="255"></label>
    <label>状态<select name="enabled"><option value="1" ${!c || c.enabled ? 'selected' : ''}>启用</option><option value="0" ${c && !c.enabled ? 'selected' : ''}>停用</option></select></label>
    <button class="btn primary">${c ? '保存' : '新建客户'}</button>
    ${c ? '<button type="button" class="btn" data-cancel-edit>取消</button>' : ''}
  </form>`
}

let editing = null
loaders.clients = async () => {
  const list = await loadClients()
  $('tab-clients').innerHTML = `${clientForm(editing)}<div id="client-secret"></div>
    <div class="list">${list.map((c) => `<div class="item">
      <div class="item-head"><b>${esc(c.display_name || c.username)}</b><span class="muted small">${esc(c.username)}</span>
        <span class="pill ${c.enabled ? 'done' : ''}">${c.enabled ? '启用' : '已停用'}</span><span class="spacer"></span>
        <span class="small muted">最近登录 ${short(c.last_login_at)}</span></div>
      <div class="small">待付 ${num(c.claimed)} · 今日已付 <b class="ok">${num(c.paid_today)}</b> · 累计已付 ${num(c.paid)}
        · ${money(c.paid_usd, '$')} · ${money(c.paid_cny, '¥')}${c.note ? ` · ${esc(c.note)}` : ''}</div>
      <div class="row-actions">
        <button class="btn small-btn" data-edit="${c.id}">编辑 / 改密码</button>
        <button class="btn small-btn" data-clinks="${c.id}">查看链接</button>
        <button class="btn small-btn" data-kick="${c.id}">强制下线</button>
        <button class="btn small-btn danger" data-del="${c.id}" data-name="${esc(c.username)}" data-paid="${num(c.paid)}">删除</button>
      </div></div>`).join('') || '<p class="muted">还没有客户</p>'}</div>`
}

$('tab-clients').addEventListener('submit', (e) => {
  e.preventDefault()
  const form = e.target
  const f = new FormData(form)
  guard(async () => {
    const body = {
      username: String(f.get('username')).trim(),
      display_name: String(f.get('display_name')).trim(),
      enabled: f.get('enabled') === '1',
      claim_timeout_minutes: Number(f.get('claim_timeout_minutes')),
      note: String(f.get('note')).trim(),
      max_claim: 500
    }
    const pw = String(f.get('password'))
    if (pw) body.password = pw
    if (form.dataset.id) body.id = Number(form.dataset.id)
    await adm('client_save', body)
    editing = null
    await loaders.clients()
    if (pw) {
      $('client-secret').innerHTML = `<div class="card"><p class="small muted">把登录信息发给客户（密码只显示这一次）：</p>
        <div class="secret">网址：${esc(location.origin)}/\n账号：${esc(body.username)}\n密码：${esc(pw)}</div></div>`
    } else toast('已保存')
  })
})

$('tab-clients').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.hasAttribute('data-cancel-edit')) { editing = null; return guard(loaders.clients) }
  if (b.dataset.edit) { editing = clientsCache.find((c) => String(c.id) === b.dataset.edit); return guard(loaders.clients) }
  if (b.dataset.clinks) return openLinks({ client_id: Number(b.dataset.clinks) })
  if (b.dataset.kick) return guard(async () => { await adm('client_kick', { id: Number(b.dataset.kick) }); toast('已强制下线') })
  if (b.dataset.del) {
    if (num(b.dataset.paid) > 0) return toast('这个客户有已付款记录，不能删除，请改为停用')
    if (!confirm(`删除客户 ${b.dataset.name}？手里没付的链接会收回换新。`)) return
    guard(async () => { await adm('client_delete', { id: Number(b.dataset.del) }); toast('已删除'); await loaders.clients() })
  }
})
// ============ 链接 ============
const REASON = { revoked: '收回', expired: 'Stripe 过期', replaced: '客户更换', released: '客户退回', timeout: '超时未付' }
const linkFilter = { page: 1, page_size: 50 }

// 从派单 / 客户页跳过来：带上筛选条件切到链接页
function openLinks(filter) {
  for (const k of ['client_id', 'order_id', 'statuses', 'tier', 'q', 'from', 'to']) delete linkFilter[k]
  Object.assign(linkFilter, filter, { page: 1 })
  document.querySelector('.tab[data-tab="links"]').click()
}

loaders.links = async () => {
  if (!clientsCache.length) await loadClients()
  const r = await adm('links', linkFilter)
  const pages = Math.max(1, Math.ceil(r.total / linkFilter.page_size))
  const st = linkFilter.statuses?.[0] ?? ''
  $('tab-links').innerHTML = `
    <form class="card form" id="link-filter">
      <label>客户<select name="client_id"><option value="">全部</option>${clientOptions(linkFilter.client_id)}</select></label>
      <label>状态<select name="status"><option value="">全部</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>档位<select name="tier"><option value="">全部</option>${TIERS.map((t) => `<option ${t === linkFilter.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>付款从<input name="from" type="date" value="${esc(linkFilter.from ?? '')}"></label>
      <label>付款到<input name="to" type="date" value="${esc(linkFilter.to ?? '')}"></label>
      <label>搜索<input name="q" value="${esc(linkFilter.q ?? '')}" placeholder="cs_live_… / 批次号"></label>
      <button class="btn primary">筛选</button>
    </form>
    <div class="item-head small">
      <span>共 ${r.total} 条</span>${linkFilter.order_id ? '<button class="btn small-btn" data-clear-order>只看当前批次 ✕</button>' : ''}<span class="spacer"></span>
      <button class="btn small-btn" data-copy-all>复制本页链接</button>
      <button class="btn small-btn danger" data-revoke-sel>收回选中</button>
    </div>
    <div class="list">${r.links.map((l) => `<div class="item">
      <div class="item-head">
        ${['claimed', 'checking', 'available'].includes(l.status) ? `<input type="checkbox" class="sel" value="${l.id}" aria-label="选中">` : ''}
        <span class="pill ${l.status}">${STATUS[l.status] ?? l.status}</span><span class="pill">${esc(l.tier)}</span>
        <span>${money(l.amount_due, '$')} · ${money(l.amount_cny, '¥')}</span>
        <span class="muted small">${esc(l.client || '')}</span><span class="spacer"></span>
        <span class="small muted">${l.paid_at ? `付款 ${short(l.paid_at)}` : l.claimed_at ? `领取 ${short(l.claimed_at)}` : `提取 ${short(l.extracted_at)}`}</span>
      </div>
      <div class="mono">${esc(l.url)}</div>
      <div class="small muted">${esc(l.account_ref || '')}${l.refresh_reason ? ` · 换新原因：${REASON[l.refresh_reason] ?? esc(l.refresh_reason)}` : ''}${l.stripe_status ? ` · Stripe ${esc(l.stripe_status)} ${short(l.stripe_checked_at)}` : ''}</div>
      <div class="row-actions"><button class="btn small-btn" data-copy="${esc(l.url)}">复制</button>
        ${l.status === 'checking' ? `<button class="btn small-btn" data-resolve="paid" data-id="${l.id}">确认已付</button>
        <button class="btn small-btn danger" data-resolve="expired" data-id="${l.id}">确认失效</button>` : ''}</div>
    </div>`).join('') || '<p class="muted">没有符合条件的链接</p>'}</div>
    <div class="item-head small">
      <button class="btn small-btn" data-page="${linkFilter.page - 1}" ${linkFilter.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>${linkFilter.page} / ${pages}</span>
      <button class="btn small-btn" data-page="${linkFilter.page + 1}" ${linkFilter.page >= pages ? 'disabled' : ''}>下一页</button>
    </div>`
  $('tab-links').dataset.urls = r.links.map((l) => l.url).join('\n')
}

$('tab-links').addEventListener('submit', (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  const order = linkFilter.order_id
  for (const k of Object.keys(linkFilter)) delete linkFilter[k]
  Object.assign(linkFilter, { page: 1, page_size: 50 })
  // 批次筛选只能从派单页带过来，表单里没有，筛选时保留
  if (order) linkFilter.order_id = order
  if (f.get('client_id')) linkFilter.client_id = Number(f.get('client_id'))
  if (f.get('status')) linkFilter.statuses = [f.get('status')]
  for (const k of ['tier', 'from', 'to', 'q']) if (String(f.get(k)).trim()) linkFilter[k] = String(f.get(k)).trim()
  guard(loaders.links)
})

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制')
  } catch {
    toast('复制失败，请长按手动复制')
  }
}

$('tab-links').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.copy) return copy(b.dataset.copy)
  if (b.hasAttribute('data-copy-all')) return $('tab-links').dataset.urls ? copy($('tab-links').dataset.urls) : toast('本页没有链接')
  if (b.dataset.page) { linkFilter.page = Number(b.dataset.page); return guard(loaders.links) }
  if (b.dataset.resolve) {
    const paid = b.dataset.resolve === 'paid'
    const tip = paid
      ? '记成已付款？会计入客户结算。请先在 Kiro / Stripe 确认这个号真的付了。'
      : '记成失效？这条会进入待换新，桌面端换一条新链接再上架。'
    if (!confirm(tip)) return
    return guard(async () => { await adm('link_resolve', { id: Number(b.dataset.id), result: b.dataset.resolve }); toast('已定性'); await loaders.links() })
  }
  if (b.hasAttribute('data-clear-order')) { delete linkFilter.order_id; linkFilter.page = 1; return guard(loaders.links) }
  if (b.hasAttribute('data-revoke-sel')) {
    const ids = [...document.querySelectorAll('#tab-links .sel:checked')].map((c) => Number(c.value))
    if (!ids.length) return toast('先勾选要收回的链接')
    if (!confirm(`收回 ${ids.length} 条链接？旧链接作废，桌面端下一轮会换新上架。`)) return
    guard(async () => { const r = await adm('link_revoke', { ids }); toast(`已收回 ${r.revoked} 条`); await loaders.links() })
  }
})

// ============ 日志 ============
const OPS = {
  client_save: '保存客户', client_delete: '删除客户', client_kick: '强制下线', link_revoke: '收回链接',
  link_resolve: '手动定性', order_create: '派单', order_update: '修改批次', backfill_paid: '补记已付'
}
loaders.logs = async () => {
  const { logs } = await adm('logs', { page_size: 200 })
  $('tab-logs').innerHTML = `<div class="list">${logs.map((l) => `<div class="item">
    <div class="item-head"><b>${OPS[l.op] ?? esc(l.op)}</b><span class="pill">${l.actor === 'desktop' ? '桌面端' : esc(l.actor)}</span>
      <span class="spacer"></span><span class="small muted">${esc(l.at)} · ${esc(l.ip)}</span></div>
    <div class="mono">${esc(l.detail)}</div></div>`).join('') || '<p class="muted">还没有操作记录</p>'}</div>`
}

guard(loaders.overview)
