// 管理后台（续）：结算记录 / 客户 / 链接 / 日志，以及路由与全局事件。依赖 admin.js
Object.assign(A, {
  settle: { page: 1, size: 20, client_id: '' },
  links: { page: 1, size: 50, client_id: '', status: '', tier: '', q: '', from: '', to: '', order_id: '' },
  logs: { page: 1, size: 30, op: '' }
})

// ============ 结算记录 ============
async function viewSettlements() {
  const f = A.settle
  const [r] = await Promise.all([adm('settlements', { page: f.page, page_size: f.size, client_id: f.client_id }), loadClients()])
  $('#top-actions').innerHTML = '<button class="btn primary" data-add-settle-top>＋ 记一笔打款</button>'
  const owed = A.clients.filter((c) => num(c.unsettled) > 0.004)
  $('[data-section="settlements"]').innerHTML = `
    ${owed.length ? `<div class="card"><div class="card-head"><h2>待结算</h2><span class="small muted">按客户：应结 − 已结</span></div>
      <div class="table-wrap"><table class="table stack"><thead><tr><th>客户</th><th class="right">应结</th><th class="right">已结</th><th class="right">未结</th><th>收款地址</th><th></th></tr></thead>
      <tbody>${owed.map((c) => `<tr>
        <td data-label="客户"><b>${esc(c.display_name || c.username)}</b></td>
        <td data-label="应结" class="right num">${usd(c.due)}</td><td data-label="已结" class="right num ok">${usd(c.settled)}</td>
        <td data-label="未结" class="right num warn"><b>${usd(c.unsettled)}</b></td>
        <td data-label="收款地址">${walletCell(c)}</td>
        <td class="right nowrap"><button class="btn sm" data-client-orders="${c.id}" data-settle-filter="unsettled">未结批次</button>
          <button class="btn sm primary" data-pay-client="${c.id}">打款</button></td>
      </tr>`).join('')}</tbody></table></div></div>` : '<div class="callout ok"><div class="grow"><b>没有待结算的</b><span class="small">所有客户的已付款都已结清。</span></div></div>'}
    <div class="card">
      <div class="card-head"><h2>打款记录</h2><span class="small text-2">共 ${r.total} 笔 · 合计 ${num(r.sum).toFixed(2)}</span></div>
      <div class="toolbar"><select data-sf="client_id" aria-label="客户">${clientOptions(f.client_id)}</select></div>
      ${settleTable(r.settlements)}
      <div class="pager" id="settle-pager"></div>
    </div>`
  pager($('#settle-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewSettlements) } })
}

// ============ 客户 ============
async function viewClients() {
  await loadClients()
  $('#top-actions').innerHTML = '<button class="btn primary" data-edit-client="new">＋ 新建客户</button>'
  $('[data-section="clients"]').innerHTML = `<div class="card">
    ${A.clients.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
        <th>客户</th><th>状态</th><th>收款地址</th><th class="right">待付</th><th class="right">已付</th><th class="right">未结</th><th>领取时限</th><th>最近登录</th><th></th>
      </tr></thead><tbody>${A.clients.map((c) => `<tr>
        <td data-label="客户"><b>${esc(c.display_name || c.username)}</b><div class="small muted">${esc(c.username)}${c.note ? ` · ${esc(c.note)}` : ''}</div></td>
        <td data-label="状态">${c.enabled ? '<span class="badge ok">启用</span>' : '<span class="badge">已停用</span>'}</td>
        <td data-label="收款地址">${walletCell(c)}</td>
        <td data-label="待付" class="right num">${num(c.claimed)}</td>
        <td data-label="已付" class="right num">${num(c.paid)}<div class="small muted">应结 ${usd(c.due)}${c.unit_price !== null ? ` · 每条 ${usd(c.unit_price)}` : ''}</div></td>
        <td data-label="未结" class="right num ${num(c.unsettled) > 0 ? 'warn' : ''}">${usd(c.unsettled)}</td>
        <td data-label="领取时限" class="small">${num(c.claim_timeout_minutes) % 1440 === 0 ? `${num(c.claim_timeout_minutes) / 1440} 天` : `${Math.round(num(c.claim_timeout_minutes) / 60)} 小时`}</td>
        <td data-label="最近登录" class="small text-2">${dt(c.last_login_at)}</td>
        <td class="right nowrap"><button class="btn sm" data-edit-client="${c.id}">编辑</button>
          <button class="btn sm" data-client-orders="${c.id}">批次</button>
          <button class="btn sm ghost" data-kick="${c.id}">下线</button>
          <button class="btn sm ghost danger" data-del-client="${c.id}" data-paid="${num(c.paid)}">删除</button></td>
      </tr>`).join('')}</tbody></table></div>` : empty('还没有客户', '点右上角新建')}
  </div>`
}

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join('')
}

function clientModal(c) {
  const isNew = !c
  const pw = isNew ? randomPassword() : ''
  const m = modal(isNew ? '新建客户' : `编辑客户 · ${esc(c.username)}`, `<form class="form-grid" id="client-form">
      <label class="field"><span>登录账号</span><input name="username" value="${esc(c?.username ?? '')}" pattern="[A-Za-z0-9_.\\-]{3,32}" required></label>
      <label class="field"><span>显示名称</span><input name="display_name" value="${esc(c?.display_name ?? '')}" maxlength="64"></label>
      <label class="field"><span>${isNew ? '密码' : '新密码（留空不改）'}</span><input name="password" value="${pw}" minlength="8" ${isNew ? 'required' : ''} autocomplete="new-password"></label>
      <label class="field"><span>状态</span><select name="enabled"><option value="1" ${!c || c.enabled ? 'selected' : ''}>启用</option><option value="0" ${c && !c.enabled ? 'selected' : ''}>停用</option></select></label>
      <label class="field"><span>领取时限</span><select name="claim_timeout_minutes">${[[180, '3 小时'], [720, '12 小时'], [1440, '1 天'], [4320, '3 天'], [10080, '7 天（线下发出的客户）']].map(([v, l]) =>
        `<option value="${v}" ${num(c?.claim_timeout_minutes ?? 180) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>单次最多领取</span><input name="max_claim" type="number" min="1" max="500" value="${num(c?.max_claim ?? 50)}"></label>
      <label class="field"><span>默认每条结算单价（可空）</span><input name="unit_price" type="number" step="0.01" min="0" value="${c?.unit_price ?? ''}" placeholder="空 = 按每条实付金额"></label>
      <label class="field"><span>备注</span><input name="note" value="${esc(c?.note ?? '')}" maxlength="255"></label>
      <div class="span-2 section-title">收款地址（只支持 Polygon；客户自己在门户里填，需要时可代填）</div>
      <label class="field"><span>网络</span><select name="wallet_network">${A.networks.map((n) => `<option value="${n.id}" ${(c?.wallet_network ?? 'polygon') === n.id ? 'selected' : ''}>${n.name}</option>`).join('')}</select></label>
      <label class="field"><span>币种</span><select name="wallet_token">${A.tokens.map((t) => `<option ${(c?.wallet_token ?? 'USDT') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field span-2"><span>地址</span><input name="wallet_address" class="mono" value="${esc(c?.wallet_network === 'polygon' ? c?.wallet_address ?? '' : '')}" spellcheck="false" autocomplete="off"></label>
    </form>`, { wide: true, foot: '<button class="btn" data-close>取消</button><button class="btn primary" data-ok>保存</button>' })
  m.el.querySelector('[data-ok]').addEventListener('click', () => {
    const form = m.el.querySelector('form')
    if (!form.reportValidity()) return
    const f = new FormData(form)
    const body = {
      username: String(f.get('username')).trim(), display_name: String(f.get('display_name')).trim(), enabled: f.get('enabled') === '1',
      claim_timeout_minutes: Number(f.get('claim_timeout_minutes')), max_claim: Number(f.get('max_claim')), note: String(f.get('note')).trim(),
      wallet_network: f.get('wallet_network'), wallet_token: f.get('wallet_token'), wallet_address: String(f.get('wallet_address')).trim(),
      unit_price: f.get('unit_price')
    }
    const password = String(f.get('password'))
    if (password) body.password = password
    if (c) body.id = c.id
    guard(async () => {
      await adm('client_save', body)
      m.close()
      await viewClients()
      if (password) {
        modal('把登录信息发给客户', `<p class="small text-2" style="margin:0">密码只显示这一次。</p>
          <pre class="card card-body mono" style="margin:0;white-space:pre-wrap;user-select:all">网址：${esc(location.origin)}/\n账号：${esc(body.username)}\n密码：${esc(password)}</pre>`,
        { foot: `<button class="btn primary" data-copy-cred>复制</button>` }).el.querySelector('[data-copy-cred]').addEventListener('click', async () => {
          await copy(`网址：${location.origin}/\n账号：${body.username}\n密码：${password}`)
          toast('已复制', 'ok')
        })
      } else toast('已保存', 'ok')
    })
  })
}
// ============ 链接 ============
async function viewLinks() {
  if (!A.clients.length) await loadClients()
  const f = A.links
  const body = { page: f.page, page_size: f.size }
  for (const k of ['client_id', 'tier', 'q', 'from', 'to', 'order_id']) if (f[k]) body[k] = f[k]
  if (f.status) body.statuses = [f.status]
  if (f.order_id) body.include_void = 1
  const r = await adm('links', body)
  $('#top-actions').innerHTML = ''
  const opt = (map, sel) => Object.entries(map).map(([k, [, l]]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('')
  $('[data-section="links"]').innerHTML = `<div class="card">
    <div class="toolbar">
      <input type="search" data-lk="q" value="${esc(f.q)}" placeholder="搜 cs_live_… / 批次号">
      <select data-lk="client_id" aria-label="客户">${clientOptions(f.client_id)}</select>
      <select data-lk="status" aria-label="状态"><option value="">全部状态</option>${opt(LINK, f.status)}</select>
      <select data-lk="tier" aria-label="档位"><option value="">全部档位</option>${['pro', 'pro+', 'promax', 'power'].map((t) => `<option ${f.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="small text-2">付款从 <input type="date" data-lk="from" value="${esc(f.from)}"></label>
      <label class="small text-2">到 <input type="date" data-lk="to" value="${esc(f.to)}"></label>
      ${f.order_id ? '<button class="btn sm" data-lk-clear-order>只看当前批次 ✕</button>' : ''}
      <span class="grow"></span>
      <button class="btn sm" data-lk-copy>复制本页</button>
      <button class="btn sm danger" data-lk-revoke>收回所选</button>
    </div>
    ${r.links.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
        <th class="c-check"></th><th>状态</th><th>档位</th><th class="right">金额</th><th>客户</th><th>链接</th><th>时间</th><th></th>
      </tr></thead><tbody>${r.links.map((l) => `<tr>
        <td class="c-check">${['claimed', 'checking', 'available'].includes(l.status) ? `<input type="checkbox" class="lk-sel" value="${l.id}" aria-label="选择">` : ''}</td>
        <td data-label="状态">${badge(LINK, l.status)}${l.refresh_reason ? `<div class="small muted">${esc(l.refresh_reason)}</div>` : ''}</td>
        <td data-label="档位">${esc(l.tier)}</td>
        <td data-label="金额" class="right num">${usd(l.amount_due)}<div class="small muted">${cny(l.amount_cny)}</div></td>
        <td data-label="客户">${esc(l.client || '-')}</td>
        <td data-label="链接" class="url">${linkCell(l.url, { void: l.status === 'superseded', copyTitle: '点击复制整条链接' })}</td>
        <td data-label="时间" class="small text-2 nowrap">${l.paid_at ? `付 ${dt(l.paid_at)}` : l.claimed_at ? `领 ${dt(l.claimed_at)}` : `提 ${dt(l.extracted_at)}`}</td>
        <td class="right nowrap">${l.status === 'checking' ? `<button class="btn sm" data-resolve="paid" data-id="${l.id}">已付</button><button class="btn sm danger" data-resolve="expired" data-id="${l.id}">失效</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : empty('没有符合条件的链接')}
    <div class="pager" id="links-pager"></div>
  </div>`
  A.linkUrls = r.links.map((l) => l.url)
  pager($('#links-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100, 200], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewLinks) } })
}

// ============ 日志 ============
const OPS = {
  client_save: '保存客户', client_delete: '删除客户', client_kick: '强制下线', link_revoke: '收回链接', link_resolve: '手动定性',
  order_create: '派单', order_update: '修改批次', order_settle: '修改结算', settlement_add: '记录打款', settlement_delete: '删除打款',
  wallet_save: '客户改收款地址', assign_links: '分配链接', backfill_paid: '补记已付', fix_batches: '修正批次',
  assign_client1: '归属客户', assign_client2: '归属客户'
}
async function viewLogs() {
  const f = A.logs
  const r = await adm('logs', { page: f.page, page_size: f.size, filter_op: f.op })
  $('#top-actions').innerHTML = ''
  $('[data-section="logs"]').innerHTML = `<div class="card">
    <div class="toolbar"><select data-lg="op" aria-label="操作"><option value="">全部操作</option>${Object.entries(OPS).map(([k, v]) => `<option value="${k}" ${f.op === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${r.logs.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>IP</th><th>内容</th></tr></thead>
      <tbody>${r.logs.map((l) => `<tr>
        <td data-label="时间" class="nowrap small">${esc(l.at)}</td>
        <td data-label="操作"><span class="badge ${l.op === 'wallet_save' ? 'danger' : l.op.startsWith('settlement') || l.op === 'order_settle' ? 'primary' : 'plain'}">${esc(OPS[l.op] ?? l.op)}</span></td>
        <td data-label="操作人" class="small">${l.actor === 'desktop' ? '桌面端' : esc(l.actor)}</td>
        <td data-label="IP" class="small mono">${esc(l.ip)}</td>
        <td data-label="内容" class="url"><span class="mono" title="${esc(l.detail)}">${esc(l.detail)}</span></td>
      </tr>`).join('')}</tbody></table></div>` : empty('还没有操作记录')}
    <div class="pager" id="logs-pager"></div>
  </div>`
  pager($('#logs-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [30, 100, 200], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewLogs) } })
}

// ============ 路由 / 事件 ============
const VIEWS = { overview: viewOverview, orders: viewOrders, settlements: viewSettlements, clients: viewClients, links: viewLinks, logs: viewLogs }
const TITLES = { overview: '总览', orders: '批次', settlements: '结算', clients: '客户', links: '链接', logs: '日志' }
function render() {
  $('#page-title').textContent = TITLES[A.view]
  $('#top-actions').innerHTML = ''
  return guard(VIEWS[A.view])
}
const nav = UI.mountNav({ onChange: (v) => { A.view = v; render() } })
function goto(view, patch) {
  if (patch) Object.assign(A[view === 'orders' ? 'orders' : view], patch, { page: 1 })
  nav.go(view)
}

document.addEventListener('click', async (e) => {
  const t = e.target
  if (t.closest('[data-goto]')) return nav.go(t.closest('[data-goto]').dataset.goto)
  const gl = t.closest('[data-goto-links]')
  if (gl) return goto('links', { status: gl.dataset.gotoLinks, client_id: '', order_id: '' })
  const co = t.closest('[data-client-orders]')
  if (co) return goto('orders', { client_id: co.dataset.clientOrders, status: '', settle: co.dataset.settleFilter || '' })
  if (t.closest('[data-new-order]')) return newOrderModal()
  if (t.closest('[data-add-settle-top]')) return settleModal({ client_id: A.settle.client_id, onDone: viewSettlements })
  const pc = t.closest('[data-pay-client]')
  if (pc) return settleModal({ client_id: pc.dataset.payClient, onDone: viewSettlements })
  if (t.closest('.drawer, .modal')) return
  const ord = t.closest('[data-order]')
  if (ord && !t.closest('input, a')) return guard(() => openOrder(ord.dataset.order))
  const c = t.closest('[data-copy]')
  if (c) { await copy(c.dataset.copy); return toast('已复制', 'ok') }
  const del = t.closest('[data-del-settle]')
  if (del) return deleteSettlement(del.dataset.delSettle, render)
  const ec = t.closest('[data-edit-client]')
  if (ec) return clientModal(ec.dataset.editClient === 'new' ? null : A.clients.find((x) => String(x.id) === ec.dataset.editClient))
  const k = t.closest('[data-kick]')
  if (k) return guard(async () => { await adm('client_kick', { id: Number(k.dataset.kick) }); toast('已强制下线', 'ok') })
  const dc = t.closest('[data-del-client]')
  if (dc) {
    if (num(dc.dataset.paid) > 0) return toast('这个客户有已付款记录，不能删除，请改为停用', 'error')
    if (!(await confirm('删除客户', '删除后客户手里没付的链接会收回换新。确定删除？', { ok: '删除', cancel: '取消', danger: true }))) return
    return guard(async () => { await adm('client_delete', { id: Number(dc.dataset.delClient) }); toast('已删除', 'ok'); viewClients() })
  }
  const rs = t.closest('[data-resolve]')
  if (rs) {
    const paid = rs.dataset.resolve === 'paid'
    if (!(await confirm(paid ? '确认已付' : '确认失效', paid ? '记成已付款，计入客户结算。' : '记成失效，进入待换新。', { ok: '确定', cancel: '取消', danger: !paid }))) return
    return guard(async () => { await adm('link_resolve', { id: Number(rs.dataset.id), result: rs.dataset.resolve }); toast('已定性', 'ok'); viewLinks() })
  }
  if (t.closest('[data-lk-clear-order]')) { A.links.order_id = ''; A.links.page = 1; return render() }
  if (t.closest('[data-lk-copy]')) { if (!A.linkUrls?.length) return toast('本页没有链接'); await copy(A.linkUrls.join('\n')); return toast(`已复制 ${A.linkUrls.length} 条`, 'ok') }
  if (t.closest('[data-lk-revoke]')) {
    const ids = [...document.querySelectorAll('.lk-sel:checked')].map((x) => Number(x.value))
    if (!ids.length) return toast('先勾选要收回的链接')
    if (!(await confirm('收回链接', `收回 ${ids.length} 条？旧链接作废，桌面端下一轮换新上架。`, { ok: '收回', cancel: '取消', danger: true }))) return
    return guard(async () => { const r = await adm('link_revoke', { ids }); toast(`已收回 ${r.revoked} 条`, 'ok'); viewLinks() })
  }
  const of = t.closest('[data-of][data-v]')
  if (of) { A.orders[of.dataset.of] = of.dataset.v; A.orders.page = 1; return render() }
})

// 筛选：下拉 / 日期即时生效，搜索框回车或失焦生效
document.addEventListener('change', (e) => {
  const el = e.target
  const map = [['data-of', A.orders], ['data-sf', A.settle], ['data-lk', A.links], ['data-lg', A.logs]]
  for (const [attr, state] of map) {
    if (!el.hasAttribute(attr) || el.hasAttribute('data-v')) continue
    state[el.getAttribute(attr)] = el.value.trim()
    state.page = 1
    return render()
  }
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[type="search"]')) e.target.blur()
})

$('#logout').addEventListener('click', async () => {
  await fetch('api.php?action=admin_logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
})

// 总览每 15 秒刷一次（开着抽屉 / 弹窗、页面在后台时不刷）
setInterval(() => {
  if (document.hidden || A.drawer || document.querySelector('.modal')) return
  if (A.view === 'overview') render()
}, 15000)

A.view = nav.initial
nav.go(A.view, false)