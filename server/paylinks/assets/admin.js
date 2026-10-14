// 管理后台：总览 / 批次（详情抽屉里结算、记打款、传凭证）。结算记录 / 客户 / 链接 / 日志在 admin-more.js
const { $, esc, num, usd, cny, dt, short, linkCell, toast, copy, drawer, modal, confirm, pager, guard } = UI
const CSRF = $('.shell').dataset.csrf
const http = UI.client({ csrf: CSRF, errText: (d) => d?.error || '操作失败' })
/** 管理接口：POST action=admin {op, ...} */
const adm = (op, body = {}) => http.post('admin', { op, ...body })
const ZH = {
  pager_info: ({ from, to, total }) => `第 ${from}–${to} 条，共 ${total} 条`,
  pager_size: ({ n }) => `每页 ${n} 条`,
  pager_prev: () => '上一页',
  pager_next: () => '下一页'
}
const tt = (k, p) => ZH[k](p || {})

const A = {
  view: 'overview',
  clients: [],
  networks: [
    { id: 'polygon', name: 'Polygon' }, { id: 'ethereum', name: 'Ethereum' }, { id: 'bsc', name: 'BNB Chain' },
    { id: 'arbitrum', name: 'Arbitrum' }, { id: 'tron', name: 'Tron' }
  ],
  tokens: ['USDT', 'USDC'],
  orders: { page: 1, size: 20, status: 'open', settle: '', client_id: '', q: '' },
  drawer: null
}

// ============ 小部件 ============
const ORDER = { open: ['info', '进行中'], done: ['ok', '已完成'], cancelled: ['', '已取消'] }
const SETTLE = { unsettled: ['warn', '未结算'], partial: ['info', '部分结算'], settled: ['ok', '已结算'] }
const LINK = {
  available: ['primary', '可领取'], claimed: ['warn', '已领待付'], checking: ['info', '确认中'],
  paid: ['ok', '已付款'], refresh: ['', '待换新'], superseded: ['void', '已作废']
}
const badge = (map, k) => `<span class="badge ${map[k]?.[0] ?? ''}">${esc(map[k]?.[1] ?? k)}</span>`
const sourceTag = (o) => (o.source === 'offline' ? '<span class="badge plain" title="线下（TXT / Excel）发出后补建：不从池子领、不自动补">线下</span>' : '')
const netName = (id) => A.networks.find((n) => n.id === id)?.name || id
const empty = (title, hint = '') => `<div class="empty"><b>${esc(title)}</b>${esc(hint)}</div>`
const progress = (paid, qty) => {
  const pct = Math.min(100, Math.round((num(paid) / Math.max(1, num(qty))) * 100))
  return `<div class="progress" title="${pct}%"><span style="width:${pct}%"></span></div>`
}
/** 收款地址最近 24 小时改过：打款前提醒核对 */
const walletFresh = (c) => c.wallet_updated_at && Date.now() - Date.parse(String(c.wallet_updated_at).replace(' ', 'T') + '+08:00') < 864e5
function walletCell(c) {
  if (!c.wallet_address) return '<span class="badge warn">未设置</span>'
  return `<span class="small text-2">${esc(netName(c.wallet_network))} · ${esc(c.wallet_token)}</span>
    <div class="mono" title="${esc(c.wallet_address)}">${esc(short(c.wallet_address, 8, 6))}</div>
    ${walletFresh(c) ? `<span class="badge danger" title="${esc(c.wallet_updated_at)}">24 小时内改过</span>` : ''}`
}
const clientOptions = (sel, { all = '全部客户' } = {}) =>
  `${all ? `<option value="">${esc(all)}</option>` : ''}${A.clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''}>${esc(c.display_name || c.username)}</option>`).join('')}`
async function loadClients() {
  A.clients = (await adm('clients')).clients
  return A.clients
}

// ============ 总览 ============
async function viewOverview() {
  const [o] = await Promise.all([adm('overview'), loadClients()])
  const tot = {}
  for (const r of o.by_status) {
    const s = (tot[r.status] ??= { n: 0, usd: 0 })
    s.n += num(r.n); s.usd += num(r.usd)
  }
  const ds = o.desktop
  const ago = ds ? Math.round((Date.parse(o.now.replace(' ', 'T')) - Date.parse(ds.at.replace(' ', 'T'))) / 60000) : null
  const alive = ago !== null && ago <= 10
  $('#desktop-state').innerHTML = alive ? '<span class="ok">● 桌面端在线</span>' : '<span class="danger">● 桌面端离线</span>'
  $('#nav-orders').textContent = o.settle.open_orders || ''
  $('#nav-unsettled').textContent = o.settle.unsettled_orders || ''
  const today = (o.now || '').slice(0, 10)
  const paidToday = o.daily.filter((d) => d.day === today).reduce((n, d) => n + num(d.n), 0)
  const unsettled = Math.max(0, o.settle.due - o.settle.settled)
  $('[data-section="overview"]').innerHTML = `
    ${alive ? '' : `<div class="callout danger"><div class="grow"><b>桌面端离线</b><span class="small">${ds ? `最后同步 ${esc(ds.at)}（${ago} 分钟前）` : '还没有收到过同步'}。补货、换新、确认付款都要桌面端开着。</span></div></div>`}
    ${num(o.stuck_checking) ? `<div class="callout warn"><div class="grow"><b>${o.stuck_checking} 条确认中超过 30 分钟</b><span class="small">桌面端开着还卡住，多半是对应账号已不在桌面端，可在链接页手动定性。</span></div>
      <button class="btn sm" data-goto-links="checking">去处理</button></div>` : ''}
    <div class="stats">
      <div class="card stat accent-primary"><span class="stat-label">池子可领取</span><span class="stat-value">${tot.available?.n ?? 0}</span><span class="stat-sub">${usd(tot.available?.usd)}</span></div>
      <div class="card stat accent-warn"><span class="stat-label">客户待付</span><span class="stat-value">${(tot.claimed?.n ?? 0) + (tot.checking?.n ?? 0)}</span>
        <span class="stat-sub">${tot.checking?.n ? `${tot.checking.n} 条确认中` : usd(tot.claimed?.usd)}</span></div>
      <div class="card stat accent-ok"><span class="stat-label">今日已付</span><span class="stat-value">${paidToday}</span><span class="stat-sub">累计 ${tot.paid?.n ?? 0} 条</span></div>
      <div class="card stat"><span class="stat-label">应结 / 已结</span><span class="stat-value">${usd(o.settle.settled)}</span>
        <span class="stat-sub">应结 ${usd(o.settle.due)} · 未结 <b class="${unsettled > 0 ? 'warn' : ''}">${usd(unsettled)}</b></span></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>客户结算概况</h2><button class="btn sm" data-goto="settlements">结算记录</button></div>
      ${A.clients.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
          <th>客户</th><th class="right">待付</th><th class="right">已付</th><th class="right">应结</th><th class="right">已结</th><th class="right">未结</th><th>收款地址</th><th></th>
        </tr></thead><tbody>${A.clients.map((c) => `<tr>
          <td data-label="客户"><b>${esc(c.display_name || c.username)}</b><div class="small muted">${esc(c.username)}</div></td>
          <td data-label="待付" class="right num">${num(c.claimed)}</td>
          <td data-label="已付" class="right num">${num(c.paid)}<div class="small muted">今日 ${num(c.paid_today)}</div></td>
          <td data-label="应结" class="right num">${usd(c.paid_usd)}</td>
          <td data-label="已结" class="right num ok">${usd(c.settled)}</td>
          <td data-label="未结" class="right num ${num(c.unsettled) > 0 ? 'warn' : ''}"><b>${usd(c.unsettled)}</b></td>
          <td data-label="收款地址">${walletCell(c)}</td>
          <td class="right"><button class="btn sm" data-client-orders="${c.id}">批次</button></td>
        </tr>`).join('')}</tbody></table></div>` : empty('还没有客户')}
    </div>
    <div class="card"><div class="card-head"><h2>近 14 天已付款</h2></div><div class="card-body">${dailyTable(o.daily)}</div></div>`
}

function dailyTable(daily) {
  const days = [...new Set(daily.map((d) => d.day))].sort().reverse()
  if (!days.length) return '<span class="muted">暂无</span>'
  const per = {}
  for (const d of daily) ((per[d.client || '-'] ??= {})[d.day] = num(d.n))
  return `<div class="table-wrap"><table class="table"><thead><tr><th>客户</th>${days.map((d) => `<th class="right">${d.slice(5)}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(per).map(([n, m]) => `<tr><td>${esc(n)}</td>${days.map((d) => `<td class="right num">${m[d] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
// ============ 批次列表 ============
async function viewOrders() {
  if (!A.clients.length) await loadClients()
  const f = A.orders
  const r = await adm('orders', { page: f.page, page_size: f.size, status: f.status, settle: f.settle, client_id: f.client_id, q: f.q })
  const seg = (v, label) => `<button data-of="status" data-v="${v}" class="${f.status === v ? 'active' : ''}">${label}</button>`
  $('#top-actions').innerHTML = '<button class="btn primary" data-new-order>＋ 派单</button>'
  $('[data-section="orders"]').innerHTML = `<div class="card">
    <div class="toolbar">
      <input type="search" data-of="q" value="${esc(f.q)}" placeholder="搜批次号 / 备注">
      <select data-of="client_id" aria-label="客户">${clientOptions(f.client_id)}</select>
      <div class="seg" role="group">${seg('open', '进行中')}${seg('done', '已完成')}${seg('cancelled', '已取消')}${seg('', '全部')}</div>
      <select data-of="settle" aria-label="结算状态">
        <option value="">全部结算状态</option>${Object.entries(SETTLE).map(([k, [, l]]) => `<option value="${k}" ${f.settle === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${r.orders.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
        <th>批次</th><th>客户</th><th>档位</th><th>进度</th><th class="right">应结</th><th>结算</th><th>状态</th><th>创建</th><th></th>
      </tr></thead><tbody>${r.orders.map((o) => `<tr class="clickable" data-order="${o.id}">
        <td data-label="批次"><b>${esc(o.code)}</b> ${sourceTag(o)}${o.note ? `<div class="small muted">${esc(o.note)}</div>` : ''}</td>
        <td data-label="客户">${esc(o.client || '-')}</td>
        <td data-label="档位">${esc(o.tier)} × ${o.quantity}</td>
        <td data-label="进度">${progress(o.paid, o.quantity)}<span class="small text-2">已付 ${num(o.paid)} · 待付 ${num(o.holding)}${num(o.void) ? ` · 作废 ${num(o.void)}` : ''}</span></td>
        <td data-label="应结" class="right num">${usd(o.paid_usd)}</td>
        <td data-label="结算">${badge(SETTLE, o.settle_status)}${num(o.settled_amount) ? `<div class="small muted num">${usd(o.settled_amount)}</div>` : ''}</td>
        <td data-label="状态">${badge(ORDER, o.status)}</td>
        <td data-label="创建" class="small text-2">${dt(o.created_at)}</td>
        <td class="right"><button class="btn sm" data-order="${o.id}">管理</button></td>
      </tr>`).join('')}</tbody></table></div>` : empty('没有符合条件的批次', '换个筛选条件，或点右上角派单')}
    <div class="pager" id="orders-pager"></div>
  </div>`
  pager($('#orders-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewOrders) } })
}

function newOrderModal() {
  const m = modal('派单', `<form class="form-grid" id="new-order">
      <label class="field span-2"><span>客户</span><select name="client_id" required>${clientOptions('', { all: '' })}</select></label>
      <label class="field"><span>档位</span><select name="tier">${['pro', 'pro+', 'promax', 'power'].map((t) => `<option ${t === 'pro+' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>数量</span><input name="quantity" type="number" min="1" max="500" value="10" required></label>
      <label class="field"><span>可更换次数</span><input name="replace_limit" type="number" min="0" max="1000" placeholder="默认 = 数量"></label>
      <label class="field"><span>备注</span><input name="note" maxlength="255"></label>
    </form><p class="small muted" style="margin:0">客户在网站上按额度领取；池子不够时开着的桌面端会自动提取。</p>`, {
    foot: '<button class="btn" data-close>取消</button><button class="btn primary" data-submit>派单</button>'
  })
  m.el.querySelector('[data-submit]').addEventListener('click', () => {
    const f = new FormData(m.el.querySelector('form'))
    guard(async () => {
      const body = { client_id: Number(f.get('client_id')), tier: f.get('tier'), quantity: Number(f.get('quantity')), note: f.get('note') }
      if (f.get('replace_limit') !== '') body.replace_limit = Number(f.get('replace_limit'))
      const r = await adm('order_create', body)
      toast(`已派单 ${r.code}`, 'ok')
      m.close()
      viewOrders()
    })
  })
}
// ============ 批次详情（抽屉）：进度 / 收款地址 / 结算 / 打款记录 / 链接 ============
async function openOrder(id) {
  const load = async () => {
    const [o, links, st] = await Promise.all([
      adm('orders', { id, page: 1, page_size: 5 }).then((r) => r.orders[0]),
      adm('links', { order_id: id, include_void: 1, page_size: 500 }),
      adm('settlements', { order_id: id, page_size: 100 })
    ])
    if (!o) throw new Error('批次不存在')
    return { o, links: links.links, settlements: st.settlements }
  }
  let d = await load()
  const state = { lf: 'all' }
  const render = () => {
    const { o } = d
    const due = num(o.paid_usd)
    const left = Math.max(0, due - num(o.settled_amount))
    const links = state.lf === 'all' ? d.links : d.links.filter((l) => l.status === state.lf)
    const cnt = (s) => d.links.filter((l) => l.status === s).length
    const seg = (v, label, n) => `<button data-lf="${v}" class="${state.lf === v ? 'active' : ''}">${label} <span class="muted">${n}</span></button>`
    return `
      <div class="stats">
        <div class="card stat accent-ok"><span class="stat-label">已付</span><span class="stat-value">${num(o.paid)} / ${o.quantity}</span>${progress(o.paid, o.quantity)}</div>
        <div class="card stat accent-warn"><span class="stat-label">待付</span><span class="stat-value">${num(o.holding)}</span><span class="stat-sub">${num(o.void) ? `作废 ${num(o.void)}` : '&nbsp;'}</span></div>
        <div class="card stat"><span class="stat-label">应结</span><span class="stat-value">${usd(due)}</span><span class="stat-sub">≈ ${cny(o.paid_cny)}</span></div>
        <div class="card stat accent-primary"><span class="stat-label">已结</span><span class="stat-value">${usd(o.settled_amount)}</span>
          <span class="stat-sub">${badge(SETTLE, o.settle_status)} ${left > 0.004 ? `还差 ${usd(left)}` : ''}</span></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h2>客户收款地址</h2></div><div class="card-body">
          ${o.wallet_address ? `<dl class="kv">
            <dt>客户</dt><dd>${esc(o.client || '-')}</dd>
            <dt>网络 / 币种</dt><dd>${esc(netName(o.wallet_network))} · ${esc(o.wallet_token)}</dd>
            <dt>地址</dt><dd><span class="mono">${esc(o.wallet_address)}</span> <button class="btn sm" data-copy="${esc(o.wallet_address)}">复制</button></dd>
            <dt>最近修改</dt><dd>${esc(o.wallet_updated_at || '-')} ${walletFresh(o) ? '<span class="badge danger">24 小时内改过，打款前先跟客户确认</span>' : ''}</dd>
          </dl>` : '<div class="callout warn"><div class="grow"><b>客户还没设置收款地址</b><span class="small">让客户在门户「收款设置」里填，或在客户页代填。</span></div></div>'}
        </div></div>
        <form class="card" id="settle-form"><div class="card-head"><h2>结算状态</h2></div><div class="card-body form-grid">
          <label class="field"><span>状态</span><select name="settle_status">${Object.entries(SETTLE).map(([k, [, l]]) => `<option value="${k}" ${o.settle_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>已结金额（USD）</span><input name="settled_amount" type="number" step="0.01" min="0" value="${num(o.settled_amount).toFixed(2)}"></label>
          <label class="field span-2"><span>结算备注</span><input name="settle_note" maxlength="255" value="${esc(o.settle_note || '')}" placeholder="如：按 1:1 结算，扣手续费 1 USDT"></label>
          <div class="span-2 btn-group"><button class="btn primary">保存结算状态</button><span class="small muted">记一笔打款会自动累加已结金额并更新状态；这里可以手动改</span></div>
        </div></form>
      </div>
      <div class="card">
        <div class="card-head"><h2>打款记录</h2><button class="btn sm primary" data-add-settle>＋ 记一笔打款</button></div>
        ${settleTable(d.settlements, { withOrder: false, withClient: false })}
      </div>
      <div class="card">
        <div class="card-head"><h2>链接</h2><button class="btn sm" data-copy-unpaid ${cnt('claimed') ? '' : 'disabled'}>复制待付的 ${cnt('claimed')} 条</button></div>
        <div class="toolbar"><div class="seg" role="group">${seg('all', '全部', d.links.length)}${seg('claimed', '待付', cnt('claimed'))}${seg('checking', '确认中', cnt('checking'))}${seg('paid', '已付', cnt('paid'))}${seg('superseded', '作废', cnt('superseded'))}</div></div>
        ${links.length ? `<div class="table-wrap"><table class="table stack"><thead><tr><th class="c-n">#</th><th>状态</th><th class="right">金额</th><th>链接</th><th>时间</th><th></th></tr></thead>
          <tbody>${links.map((l, i) => `<tr><td class="c-n">${i + 1}</td><td data-label="状态">${badge(LINK, l.status)}</td>
            <td data-label="金额" class="right num">${usd(l.amount_due)}</td>
            <td data-label="链接" class="url">${linkCell(l.url, { void: l.status === 'superseded', copyTitle: '点击复制整条链接' })}</td>
            <td data-label="时间" class="small text-2">${dt(l.paid_at || l.claimed_at)}</td>
            <td class="right nowrap">${l.status === 'checking' ? `<button class="btn sm" data-resolve="paid" data-id="${l.id}">确认已付</button><button class="btn sm danger" data-resolve="expired" data-id="${l.id}">确认失效</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : empty('没有链接')}
      </div>
      ${o.status === 'open' ? `<div class="card"><div class="card-head"><h2>批次操作</h2></div><div class="card-body btn-group">
        <button class="btn" data-oa="done">标记完成</button>
        <button class="btn" data-oa="qty">改数量（${o.quantity}）</button>
        ${o.source === 'offline' ? '' : `<button class="btn" data-oa="limit">改更换次数（${o.replaced}/${o.replace_limit}）</button>`}
        <button class="btn danger" data-oa="cancel">取消批次</button>
      </div></div>` : ''}`
  }
  const layer = drawer(`${esc(d.o.code)} ${badge(ORDER, d.o.status)} ${sourceTag(d.o)} <span class="muted small">${esc(d.o.client || '')}</span>`, render(), { closeLabel: '关闭', onClose: () => (A.drawer = null) })
  A.drawer = layer
  const root = layer.el.querySelector('.drawer-body')
  const refresh = async () => { d = await load(); root.innerHTML = render(); bind() }
  const bind = () => {
    root.querySelector('#settle-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const f = new FormData(e.currentTarget)
      guard(async () => {
        await adm('order_settle', { id: Number(id), settle_status: f.get('settle_status'), settled_amount: Number(f.get('settled_amount')), settle_note: f.get('settle_note') })
        toast('结算状态已保存', 'ok')
        await refresh()
      })
    })
  }
  bind()
  root.addEventListener('click', async (e) => {
    const lf = e.target.closest('[data-lf]')
    if (lf) { state.lf = lf.dataset.lf; root.innerHTML = render(); return bind() }
    const c = e.target.closest('[data-copy]')
    if (c) { await copy(c.dataset.copy); return toast('已复制', 'ok') }
    if (e.target.closest('[data-copy-unpaid]')) {
      const urls = d.links.filter((l) => l.status === 'claimed').map((l) => l.url)
      await copy(urls.join('\n'))
      return toast(`已复制 ${urls.length} 条`, 'ok')
    }
    if (e.target.closest('[data-add-settle]')) return settleModal({ client_id: d.o.client_id, order: d.o, onDone: refresh })
    const del = e.target.closest('[data-del-settle]')
    if (del) return deleteSettlement(del.dataset.delSettle, refresh)
    const rs = e.target.closest('[data-resolve]')
    if (rs) {
      const paid = rs.dataset.resolve === 'paid'
      if (!(await confirm(paid ? '确认已付' : '确认失效', paid ? '记成已付款，计入客户结算。请先确认这个号真的付了。' : '记成失效，进入待换新，桌面端会换一条新链接。', { ok: '确定', cancel: '取消', danger: !paid }))) return
      return guard(async () => { await adm('link_resolve', { id: Number(rs.dataset.id), result: rs.dataset.resolve }); toast('已定性', 'ok'); await refresh() })
    }
    const oa = e.target.closest('[data-oa]')
    if (oa) return orderAction(oa.dataset.oa, d.o, refresh)
  })
}

async function orderAction(act, o, after) {
  if (act === 'done') {
    if (!(await confirm('标记完成', `批次 ${o.code} 标记为完成后不能再领；客户手里没付的 ${num(o.holding)} 条照样能付。`, { ok: '标记完成', cancel: '取消' }))) return
    return guard(async () => { await adm('order_update', { id: o.id, status: 'done' }); toast('已标记完成', 'ok'); await after(); viewOrders() })
  }
  if (act === 'cancel') {
    if (!(await confirm('取消批次', `取消 ${o.code}？客户手里没付的会收回换新，已付的照常结算。`, { ok: '取消批次', cancel: '不取消', danger: true }))) return
    return guard(async () => { await adm('order_update', { id: o.id, status: 'cancelled' }); toast('已取消', 'ok'); await after(); viewOrders() })
  }
  const isQty = act === 'qty'
  const min = isQty ? Math.max(1, num(o.paid) + num(o.holding)) : 0
  const m = modal(isQty ? '改数量' : '改更换次数', `<label class="field"><span>${isQty ? `数量（不能少于已付 + 待付 = ${min}）` : '可更换次数'}</span>
      <input type="number" min="${min}" max="1000" value="${isQty ? o.quantity : o.replace_limit}" autofocus></label>`, {
    foot: '<button class="btn" data-close>取消</button><button class="btn primary" data-ok>保存</button>'
  })
  m.el.querySelector('[data-ok]').addEventListener('click', () => {
    const v = Number(m.el.querySelector('input').value)
    if (!(v >= min)) return toast(`不能少于 ${min}`, 'error')
    guard(async () => { await adm('order_update', { id: o.id, [isQty ? 'quantity' : 'replace_limit']: v }); m.close(); toast('已修改', 'ok'); await after(); viewOrders() })
  })
}
// ============ 记一笔打款 / 打款记录表 ============
/**
 * 记打款：金额、网络、币种、收款地址（默认客户填的）、交易哈希、打款时间、凭证（图片 / PDF）、备注。
 * 交易哈希和凭证至少给一个。挂到批次上时自动累加批次的已结金额。
 */
async function settleModal({ client_id = '', order = null, onDone }) {
  if (!A.clients.length) await loadClients()
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16)
  const left = order ? Math.max(0, num(order.paid_usd) - num(order.settled_amount)) : 0
  const m = modal(order ? `记一笔打款 · ${esc(order.code)}` : '记一笔打款', `<form id="settle-add" class="form-grid">
      <label class="field span-2"><span>客户</span><select name="client_id" required ${order ? 'disabled' : ''}>${clientOptions(client_id, { all: '' })}</select></label>
      ${order ? '' : '<label class="field span-2"><span>批次（可不选）</span><select name="order_id"><option value="">不挂批次</option></select></label>'}
      <label class="field"><span>金额</span><input name="amount" type="number" step="0.01" min="0.01" value="${left ? left.toFixed(2) : ''}" required autofocus>
        ${order ? `<span class="hint">应结 ${usd(order.paid_usd)}，已结 ${usd(order.settled_amount)}</span>` : ''}</label>
      <label class="field"><span>币种</span><select name="token">${A.tokens.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="field"><span>网络</span><select name="network">${A.networks.map((n) => `<option value="${n.id}">${n.name}</option>`).join('')}</select></label>
      <label class="field"><span>打款时间</span><input name="paid_at" type="datetime-local" value="${now}"></label>
      <label class="field span-2"><span>收款地址</span><input name="to_address" class="mono" spellcheck="false" autocomplete="off"><span class="hint" id="addr-note"></span></label>
      <label class="field span-2"><span>交易哈希</span><input name="tx_hash" class="mono" spellcheck="false" autocomplete="off" placeholder="0x…（Polygon 上 66 位）"></label>
      <label class="field span-2"><span>付款凭证（截图或 PDF，5 MB 以内）</span><input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
      <label class="field span-2"><span>备注</span><input name="note" maxlength="255" placeholder="如：10-13 两个批次合并打款"></label>
    </form>`, { wide: true, foot: '<span class="small muted" style="margin-right:auto">交易哈希和凭证至少填一个</span><button class="btn" data-close>取消</button><button class="btn primary" data-ok>保存</button>' })
  const form = m.el.querySelector('form')
  // 按 name 直接取字段（form.xxx 具名访问对禁用的下拉框不可靠）
  const F = (n) => form.querySelector(`[name="${n}"]`)
  // 选了客户就带出他的收款地址 / 网络 / 币种，以及他的批次
  const fill = async () => {
    const c = A.clients.find((x) => String(x.id) === String(F('client_id').value))
    if (!c) return
    F('network').value = c.wallet_network || 'polygon'
    F('token').value = c.wallet_token || 'USDT'
    F('to_address').value = c.wallet_address || ''
    m.el.querySelector('#addr-note').innerHTML = c.wallet_address
      ? `客户填的地址${walletFresh(c) ? ' <span class="badge danger">24 小时内改过，先跟客户确认</span>' : ''}`
      : '<span class="warn">客户还没填收款地址，请手动填写</span>'
    if (!order && F('order_id')) {
      const r = await adm('orders', { client_id: c.id, page: 1, page_size: 100 })
      F('order_id').innerHTML = `<option value="">不挂批次</option>${r.orders.filter((o) => num(o.paid)).map((o) =>
        `<option value="${o.id}" data-left="${Math.max(0, num(o.paid_usd) - num(o.settled_amount)).toFixed(2)}">${esc(o.code)} · 应结 ${usd(o.paid_usd)} · 已结 ${usd(o.settled_amount)}</option>`).join('')}`
    }
  }
  F('client_id').addEventListener('change', fill)
  F('order_id')?.addEventListener('change', () => {
    const left = F('order_id').selectedOptions[0]?.dataset.left
    if (left && !F('amount').value) F('amount').value = left
  })
  if (F('client_id').value) await fill()
  m.el.querySelector('[data-ok]').addEventListener('click', () => {
    if (!form.reportValidity()) return
    const fd = new FormData(form)
    fd.set('client_id', F('client_id').value)
    if (order) fd.set('order_id', order.id)
    if (!fd.get('proof')?.size) fd.delete('proof')
    if (!fd.get('tx_hash') && !fd.get('proof')) return toast('交易哈希和凭证至少填一个', 'error')
    const btn = m.el.querySelector('[data-ok]')
    btn.disabled = true
    guard(async () => {
      await http.form('settlement_add', fd)
      toast('已记录打款', 'ok')
      m.close()
      await onDone?.()
    }).finally(() => (btn.disabled = false))
  })
}

function settleTable(rows, { withOrder = true, withClient = true } = {}) {
  if (!rows.length) return empty('还没有打款记录', '打款后点「记一笔打款」，附上交易哈希或截图')
  return `<div class="table-wrap"><table class="table stack"><thead><tr>
      <th>打款时间</th>${withClient ? '<th>客户</th>' : ''}${withOrder ? '<th>批次</th>' : ''}<th class="right">金额</th><th>网络 / 地址</th><th>交易</th><th>凭证</th><th>备注</th><th></th>
    </tr></thead><tbody>${rows.map((s) => `<tr>
      <td data-label="打款时间" class="nowrap">${dt(s.paid_at)}<div class="small muted">${esc(s.created_by)}</div></td>
      ${withClient ? `<td data-label="客户">${esc(s.client || '-')}</td>` : ''}
      ${withOrder ? `<td data-label="批次">${s.code ? `<button class="link-btn" data-order="${s.order_id}">${esc(s.code)}</button>` : '<span class="muted">未挂批次</span>'}</td>` : ''}
      <td data-label="金额" class="right num"><b>${num(s.amount).toFixed(2)}</b> ${esc(s.token)}</td>
      <td data-label="网络 / 地址"><span class="small text-2">${esc(s.network_name)}</span><div class="mono" title="${esc(s.to_address)}">${esc(short(s.to_address, 8, 6)) || '-'}</div></td>
      <td data-label="交易">${s.tx_hash ? (s.tx_url ? `<a href="${esc(s.tx_url)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(short(s.tx_hash, 8, 6))} ↗</a>` : `<span class="mono">${esc(short(s.tx_hash, 8, 6))}</span>`) : '<span class="muted">-</span>'}</td>
      <td data-label="凭证">${s.has_proof ? `<a href="api.php?action=proof&id=${s.id}" target="_blank" rel="noopener">查看</a>` : '<span class="muted">-</span>'}</td>
      <td data-label="备注" class="small text-2">${esc(s.note || '')}</td>
      <td class="right"><button class="btn sm ghost danger" data-del-settle="${s.id}" aria-label="删除">删除</button></td>
    </tr>`).join('')}</tbody></table></div>`
}

async function deleteSettlement(id, after) {
  if (!(await confirm('删除打款记录', '删除后批次的已结金额会扣回，凭证文件一并删除。确定删除？', { ok: '删除', cancel: '取消', danger: true }))) return
  await guard(async () => { await adm('settlement_delete', { id: Number(id) }); toast('已删除', 'ok'); await after?.() })
}