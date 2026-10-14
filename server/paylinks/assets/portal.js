// 客户门户：概览 / 我的批次（详情抽屉）/ 待付款 / 已付款 / 结算记录 / 收款设置。全部服务端分页
const { $, esc, num, usd, cny, dt, short, linkCell, toast, copy, drawer, modal, confirm, pager, guard } = UI
const api = UI.client({ csrf: $('.shell').dataset.csrf, errText: (d) => tError(d, 'network_error') })
const tt = (k, p) => t(k, p)

const S = {
  me: null,
  view: 'work',
  orders: { page: 1, size: 10, status: '', settle: '' },
  pending: { page: 1, size: 20, order_id: '' },
  paid: { page: 1, size: 20, from: '', to: '' },
  settlements: { page: 1, size: 20 },
  selected: new Set(),
  /** 刚领到的，表格里高亮 */
  fresh: new Set(),
  pendingRows: [],
  drawer: null
}

// ============ 小部件 ============
const ORDER_STATUS = { open: 'info', done: 'ok', cancelled: '' }
const SETTLE = { unsettled: 'warn', partial: 'info', settled: 'ok' }
const LINK = { claimed: 'warn', checking: 'info', paid: 'ok', void: 'void' }
const orderBadge = (s) => `<span class="badge ${ORDER_STATUS[s] ?? ''}">${esc(t(`order_${s}`))}</span>`
const settleBadge = (s) => `<span class="badge ${SETTLE[s] ?? ''}">${esc(t(`settle_${s}`))}</span>`
const linkBadge = (s) => `<span class="badge ${LINK[s] ?? ''}">${esc(t(`link_${s}`))}</span>`
const sourceTag = (o) => (o.source === 'offline' ? `<span class="badge plain" title="${esc(t('source_offline_tip'))}">${esc(t('source_offline'))}</span>` : '')
const networkName = (id) => S.me?.networks.find((n) => n.id === id)?.name || id
function txLink(s) {
  if (!s.tx_hash) return '<span class="muted">-</span>'
  return s.tx_url ? `<a href="${esc(s.tx_url)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(short(s.tx_hash, 8, 6))} ↗</a>` : `<span class="mono">${esc(short(s.tx_hash, 8, 6))}</span>`
}
const proofLink = (s) => (s.has_proof ? `<a href="api.php?action=proof&id=${s.id}" target="_blank" rel="noopener">${esc(t('view_proof'))}</a>` : '<span class="muted">-</span>')
function progress(o) {
  const pct = Math.min(100, Math.round((num(o.paid) / Math.max(1, num(o.quantity))) * 100))
  return `<div class="progress" title="${pct}%"><span style="width:${pct}%"></span></div>`
}
const empty = (title, hint = '') => `<div class="empty"><b>${esc(title)}</b>${hint ? esc(hint) : ''}</div>`
const left = (sec) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h >= 24) return t('left_d', { d: Math.floor(h / 24), h: h % 24 })
  return h ? t('left_hm', { h, m }) : t('left_m', { m })
}

// ============ 顶部 / 侧栏 ============
async function loadMe() {
  S.me = await api.get('me')
  const c = S.me.client
  const name = c.display_name || c.username
  $('#who').textContent = name
  $('#avatar').textContent = name.slice(0, 1).toUpperCase()
  $('#updated').textContent = t('updated_at', { time: S.me.now.slice(11, 16) })
  $('#nav-pending').textContent = S.me.stats.claimed || ''
  $('#nav-orders').textContent = S.me.stats.open_orders || ''
  // 有能领的额度：侧栏「我的批次」标出来，别让客户不知道有新批次
  const can = S.me.stats.claimable || 0
  const navOrders = $('#nav-orders')
  navOrders.textContent = can ? `+${can}` : S.me.stats.open_orders || ''
  navOrders.classList.toggle('hot', can > 0)
}

// ============ 付款工作台：领链接 + 待付款，打开就能复制 ============
/** 收款地址提示：没填 / 填的不是 Polygon 都要提醒 */
function walletNotice() {
  const c = S.me.client
  if (!c.wallet_address) {
    return `<div class="callout warn"><div class="grow"><b>${esc(t('wallet_missing'))}</b><span class="text-2 small">${esc(t('wallet_missing_tip'))}</span></div>
      <button class="btn sm primary" data-goto="wallet">${esc(t('wallet_set'))}</button></div>`
  }
  if (!c.wallet_network_ok) {
    return `<div class="callout danger"><div class="grow"><b>${esc(t('wallet_wrong_network', { name: c.wallet_network_name }))}</b>
      <span class="text-2 small">${esc(t('wallet_wrong_network_tip'))}</span></div>
      <button class="btn sm primary" data-goto="wallet">${esc(t('wallet_edit'))}</button></div>`
  }
  return ''
}

async function viewWork() {
  const f = S.pending
  const [, open, r] = await Promise.all([
    loadMe(),
    api.get('my_orders', { page: 1, page_size: 50, status: 'open' }),
    api.get('my_claimed', { page: f.page, page_size: f.size, order_id: f.order_id })
  ])
  const s = S.me.stats
  S.pendingRows = r.links
  const alive = new Set(r.links.map((l) => String(l.id)))
  for (const id of [...S.selected]) if (!alive.has(id)) S.selected.delete(id)
  const claimable = open.orders.filter((o) => num(o.remaining) > 0)
  const offline = open.orders.filter((o) => o.source === 'offline' && num(o.holding) > 0)
  const allChecked = r.links.length > 0 && r.links.every((l) => l.status !== 'claimed' || S.selected.has(String(l.id)))
  const maxClaim = S.me.max_claim || 50

  // 领取：每个可领的批次一行，进度 + 数量 + 领取按钮
  const claimCard = claimable.length
    ? `<div class="card">
        <div class="card-head"><h2>${esc(t('claim_title'))}</h2><span class="small text-2">${esc(t('claim_hint'))} ${esc(claimRule())}</span></div>
        <div class="claim-list">${claimable.map((o) => {
          const n = Math.min(num(o.remaining), maxClaim)
          return `<div class="claim-row">
            <div class="grow"><b>${esc(o.code)}</b> <span class="badge plain">${esc(o.tier)}</span>
              <div class="small text-2">${esc(t('target_progress', { paid: num(o.paid), qty: o.quantity, holding: num(o.holding), remaining: num(o.remaining) }))}</div>
              ${progress(o)}</div>
            <input type="number" min="1" max="${n}" value="${n}" data-claim-count="${o.id}" aria-label="${esc(t('count'))}">
            <button class="btn primary" data-claim-now="${o.id}">${esc(t('claim'))}</button>
          </div>`
        }).join('')}</div>
      </div>`
    : open.orders.length
      ? ''
      : `<div class="callout info"><div class="grow"><b>${esc(t('no_open_orders'))}</b><span class="small text-2">${esc(t('no_orders_tip'))}</span></div></div>`

  $('[data-section="work"]').innerHTML = `
    ${walletNotice()}
    <div class="page-head">
      <span class="small text-2">${esc(t('updated_at', { time: S.me.now.slice(11, 16) }))}</span>
      <button class="btn sm" data-reload>${esc(t('refresh'))}</button>
    </div>
    <div class="stats">
      <div class="card stat accent-warn"><span class="stat-label">${esc(t('stat_pending'))}</span><span class="stat-value">${s.claimed + s.checking}</span>
        <span class="stat-sub">${s.checking ? esc(t('stat_checking_n', { n: s.checking })) : esc(t('stat_pending_sub'))}</span></div>
      <div class="card stat accent-ok"><span class="stat-label">${esc(t('stat_paid'))}</span><span class="stat-value">${s.paid}</span>
        <span class="stat-sub">${esc(t('stat_today_n', { n: s.paid_today }))}</span></div>
      <div class="card stat"><span class="stat-label">${esc(t('stat_due'))}</span><span class="stat-value">${usd(s.due)}</span>
        <span class="stat-sub">${esc(t('stat_due_sub'))}</span></div>
      <div class="card stat accent-primary"><span class="stat-label">${esc(t('stat_settled'))}</span><span class="stat-value">${usd(s.settled)}</span>
        <span class="stat-sub">${esc(t('stat_unsettled_n', { n: usd(s.unsettled) }))}</span></div>
    </div>
    ${claimCard}
    <div class="card" id="pending-card">
      <div class="card-head"><h2>${esc(t('pending_title'))} <span class="badge warn plain">${r.total}</span></h2>
        <button class="btn sm primary" data-pa="copy-all" ${r.total ? '' : 'disabled'}>${esc(t('copy_all_pending', { n: r.total }))}</button>
      </div>
      <div class="toolbar">
        <label class="check"><input type="checkbox" data-check-all ${allChecked ? 'checked' : ''}> <span class="small">${esc(t('select_all'))}</span></label>
        <span class="muted small" id="sel-info">${esc(t('selected_n', { n: S.selected.size }))}</span>
        <button class="btn sm" data-pa="copy-sel">${esc(t('copy_selected'))}</button>
        <button class="btn sm" data-pa="txt">${esc(t('export_txt'))}</button>
        <button class="btn sm danger" data-pa="release">${esc(t('release_selected'))}</button>
        <span class="grow"></span>
        <select data-pf="order_id" aria-label="${esc(t('col_batch'))}"><option value="">${esc(t('all_orders'))}</option>
          ${open.orders.filter((o) => num(o.holding)).map((o) => `<option value="${o.id}" ${String(f.order_id) === String(o.id) ? 'selected' : ''}>${esc(o.code)}（${num(o.holding)}）</option>`).join('')}
        </select>
      </div>
      ${r.links.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
          <th class="c-check"></th>
          <th>${esc(t('col_link'))}</th><th>${esc(t('col_batch'))}</th><th class="right">${esc(t('col_amount'))}</th><th>${esc(t('col_left'))}</th><th></th>
        </tr></thead><tbody>${r.links.map((l) => {
          const checking = l.status === 'checking'
          return `<tr class="${S.fresh.has(String(l.id)) ? 'fresh' : ''}">
            <td class="c-check" data-label="">${checking ? '' : `<input type="checkbox" data-sel="${l.id}" ${S.selected.has(String(l.id)) ? 'checked' : ''} aria-label="${esc(t('select'))}">`}</td>
            <td data-label="${esc(t('col_link'))}" class="url">${linkCell(l.url, { copyTitle: t('click_copy') })}</td>
            <td data-label="${esc(t('col_batch'))}">${l.code ? `<button class="link-btn" data-order="${l.order_id}">${esc(l.code)}</button>` : '-'}<span class="small muted"> · ${esc(l.tier)}</span></td>
            <td data-label="${esc(t('col_amount'))}" class="right num">${usd(l.amount_due)}<div class="small muted">${cny(l.amount_cny)}</div></td>
            <td data-label="${esc(t('col_left'))}" class="nowrap">${checking ? linkBadge('checking') : `<span class="${l.expires_in < 900 ? 'warn' : 'text-2'} small">${esc(left(l.expires_in))}</span>`}</td>
            <td class="right nowrap">
              <a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(t('open_pay'))}</a>
              ${!checking && l.source !== 'offline' && l.order_id ? `<button class="btn sm ghost" data-replace="${l.id}">${esc(t('replace'))}</button>` : ''}</td>
          </tr>`
        }).join('')}</tbody></table></div>`
        : empty(t('no_claimed'), claimable.length ? t('no_claimed_claim_tip') : offline.length ? '' : t('no_claimed_tip'))}
      <div class="pager" id="pending-pager"></div>
    </div>`
  pager($('#pending-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100, 200], tt, onChange: (p, sz) => { f.page = p; f.size = sz; guard(viewWork) } })
}

/** 工作台里点「领取」：领到的自动勾上并高亮，直接点「复制所选」 */
async function claimFrom(btn) {
  const id = btn.dataset.claimNow
  const n = Math.max(1, num($(`[data-claim-count="${id}"]`)?.value))
  btn.disabled = true
  await guard(async () => {
    const res = await api.post('claim', { order_id: Number(id), count: n })
    S.fresh = new Set(res.ids.map(String))
    for (const x of res.ids) S.selected.add(String(x))
    toast(res.claimed ? t('claimed_ok', { n: res.claimed }) + (res.short ? t('claimed_short', { n: res.short }) : '') : t('waiting_stock'), res.claimed ? 'ok' : '')
    S.pending.page = 1
    S.pending.order_id = ''
    await viewWork()
    $('#pending-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  btn.disabled = false
}

/** 批次表：概览和「我的批次」共用 */
function ordersTable(rows) {
  if (!rows.length) return empty(t('no_orders'), t('no_orders_tip'))
  return `<div class="table-wrap"><table class="table stack"><thead><tr>
      <th>${esc(t('col_batch'))}</th><th>${esc(t('col_tier'))}</th><th>${esc(t('col_progress'))}</th>
      <th class="right">${esc(t('col_paid_amount'))}</th><th>${esc(t('col_status'))}</th><th>${esc(t('col_settle'))}</th><th>${esc(t('col_created'))}</th><th></th>
    </tr></thead><tbody>${rows.map((o) => `<tr class="clickable" data-order="${o.id}">
      <td data-label="${esc(t('col_batch'))}"><b>${esc(o.code)}</b> ${sourceTag(o)}${o.note ? `<div class="muted small">${esc(o.note)}</div>` : ''}</td>
      <td data-label="${esc(t('col_tier'))}">${esc(o.tier)} × ${o.quantity}</td>
      <td data-label="${esc(t('col_progress'))}">${progress(o)}<span class="small text-2">${esc(t('progress_short', { paid: num(o.paid), qty: o.quantity, holding: num(o.holding) }))}</span></td>
      <td data-label="${esc(t('col_paid_amount'))}" class="right num">${usd(o.due_amount)}${o.unit_price !== null ? `<div class="small muted">${esc(t('per_link', { p: usd(o.unit_price) }))}</div>` : ''}</td>
      <td data-label="${esc(t('col_status'))}">${orderBadge(o.status)}</td>
      <td data-label="${esc(t('col_settle'))}">${settleBadge(o.settle_status)}${num(o.settled_amount) ? `<div class="small muted num">${usd(o.settled_amount)}</div>` : ''}</td>
      <td data-label="${esc(t('col_created'))}" class="small text-2">${dt(o.created_at)}</td>
      <td class="right"><button class="btn sm" data-order="${o.id}">${esc(t('details'))}</button></td>
    </tr>`).join('')}</tbody></table></div>`
}
// ============ 我的批次 ============
async function viewOrders() {
  const f = S.orders
  const r = await api.get('my_orders', { page: f.page, page_size: f.size, status: f.status, settle: f.settle })
  const seg = (key, val, label) => `<button data-f="${key}" data-v="${val}" class="${f[key] === val ? 'active' : ''}">${esc(label)}</button>`
  $('[data-section="orders"]').innerHTML = `<div class="card">
    <div class="toolbar">
      <div class="seg" role="group">${seg('status', '', t('all'))}${seg('status', 'open', t('order_open'))}${seg('status', 'done', t('order_done'))}${seg('status', 'cancelled', t('order_cancelled'))}</div>
      <select data-f="settle" aria-label="${esc(t('col_settle'))}">
        <option value="">${esc(t('settle_all'))}</option>
        ${['unsettled', 'partial', 'settled'].map((k) => `<option value="${k}" ${f.settle === k ? 'selected' : ''}>${esc(t(`settle_${k}`))}</option>`).join('')}
      </select>
    </div>
    ${ordersTable(r.orders)}
    <div class="pager" id="orders-pager"></div>
  </div>`
  pager($('#orders-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [10, 20, 50], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewOrders) } })
}

// ============ 批次详情（抽屉） ============
async function openOrder(id) {
  const r = await api.get('my_order', { id })
  const o = r.order
  const filter = { v: 'all' }
  const due = num(o.due_amount)
  const body = () => {
    const links = filter.v === 'all' ? r.links : r.links.filter((l) => l.status === filter.v)
    const unpaid = r.links.filter((l) => l.status === 'claimed')
    const seg = (v, label, n) => `<button data-lf="${v}" class="${filter.v === v ? 'active' : ''}">${esc(label)} <span class="muted">${n}</span></button>`
    const count = (s) => r.links.filter((l) => l.status === s).length
    return `
      <div class="stats">
        <div class="card stat accent-ok"><span class="stat-label">${esc(t('stat_paid'))}</span><span class="stat-value">${num(o.paid)} / ${o.quantity}</span>${progress(o)}</div>
        <div class="card stat accent-warn"><span class="stat-label">${esc(t('stat_pending'))}</span><span class="stat-value">${num(o.holding)}</span>
          <span class="stat-sub">${num(o.void) ? esc(t('void_n', { n: num(o.void) })) : '&nbsp;'}</span></div>
        <div class="card stat"><span class="stat-label">${esc(t('stat_due'))}</span><span class="stat-value">${usd(due)}</span>
          <span class="stat-sub">${o.unit_price !== null ? esc(t('settle_by_count', { n: num(o.paid), p: usd(o.unit_price) })) : esc(t('settle_by_amount'))}</span></div>
        <div class="card stat accent-primary"><span class="stat-label">${esc(t('stat_settled'))}</span><span class="stat-value">${usd(o.settled_amount)}</span>
          <span class="stat-sub">${settleBadge(o.settle_status)}</span></div>
      </div>
      <dl class="kv">
        <dt>${esc(t('col_tier'))}</dt><dd>${esc(o.tier)}</dd>
        <dt>${esc(t('col_target'))}</dt><dd>${esc(t('target_progress', { paid: num(o.paid), qty: o.quantity, holding: num(o.holding), remaining: num(o.remaining) }))}</dd>
        <dt>${esc(t('col_source'))}</dt><dd>${o.source === 'offline' ? esc(t('source_offline_tip')) : esc(t('source_site_tip'))}</dd>
        <dt>${esc(t('col_created'))}</dt><dd>${esc(o.created_at)}</dd>
        ${o.note ? `<dt>${esc(t('col_note'))}</dt><dd>${esc(o.note)}</dd>` : ''}
      </dl>
      ${o.status === 'open' && num(o.remaining) > 0 ? `<div class="callout info"><div class="grow"><b>${esc(t('can_claim_n', { n: o.remaining }))}</b>
          <span class="text-2 small">${esc(t('claim_hint'))} ${esc(claimRule())}</span></div>
          <input type="number" min="1" max="${Math.min(num(o.remaining), S.me?.max_claim || 50)}" value="${Math.min(num(o.remaining), S.me?.max_claim || 50)}" data-claim-count style="width:90px" aria-label="${esc(t('count'))}">
          <button class="btn primary" data-claim="${o.id}">${esc(t('claim'))}</button></div>` : ''}
      <div class="card">
        <div class="card-head"><h2>${esc(t('links_title'))}</h2>
          <button class="btn sm" data-copy-unpaid ${unpaid.length ? '' : 'disabled'}>${esc(t('copy_unpaid', { n: unpaid.length }))}</button></div>
        <div class="toolbar"><div class="seg" role="group">${seg('all', t('all'), r.links.length)}${seg('claimed', t('link_claimed'), count('claimed'))}${seg('paid', t('link_paid'), count('paid'))}${seg('void', t('link_void'), count('void'))}</div></div>
        ${links.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
            <th class="c-n">#</th><th>${esc(t('col_status'))}</th><th class="right">${esc(t('col_amount'))}</th><th>${esc(t('col_link'))}</th><th>${esc(t('col_time'))}</th><th></th>
          </tr></thead><tbody>${links.map((l, i) => `<tr>
            <td class="c-n">${i + 1}</td><td data-label="${esc(t('col_status'))}">${linkBadge(l.status)}</td>
            <td data-label="${esc(t('col_amount'))}" class="right num">${usd(l.amount_due)}<div class="small muted">${cny(l.amount_cny)}</div></td>
            <td data-label="${esc(t('col_link'))}" class="url">${l.url ? linkCell(l.url, { copyTitle: t('click_copy') }) : `<span class="muted small">${esc(t('void_hint'))}</span>`}</td>
            <td data-label="${esc(t('col_time'))}" class="small text-2">${dt(l.paid_at || l.claimed_at)}</td>
            <td class="right nowrap">${l.status === 'claimed' && o.source !== 'offline' ? `<button class="btn sm ghost" data-replace="${l.id}">${esc(t('replace'))}</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : empty(t('no_links'))}
      </div>
      <div class="card">
        <div class="card-head"><h2>${esc(t('settlements_title'))}</h2><span class="muted small">${esc(t('settle_rule'))}</span></div>
        ${settlementsTable(r.settlements, false)}
      </div>`
  }
  const layer = drawer(`${esc(o.code)} ${orderBadge(o.status)} ${sourceTag(o)}`, body(), { closeLabel: t('close'), onClose: () => (S.drawer = null) })
  S.drawer = layer
  const root = layer.el.querySelector('.drawer-body')
  root.addEventListener('click', async (e) => {
    const lf = e.target.closest('[data-lf]')
    if (lf) { filter.v = lf.dataset.lf; root.innerHTML = body(); return }
    const c = e.target.closest('[data-copy]')
    if (c) { await copy(c.dataset.copy); return toast(t('copied', { n: 1 }), 'ok') }
    if (e.target.closest('[data-copy-unpaid]')) {
      const urls = r.links.filter((l) => l.status === 'claimed').map((l) => l.url)
      await copy(urls.join('\n'))
      return toast(t('copied', { n: urls.length }), 'ok')
    }
    const rep = e.target.closest('[data-replace]')
    if (rep) return replaceLink(rep.dataset.replace, () => { layer.close(); openOrder(id) })
    const cl = e.target.closest('[data-claim]')
    if (cl) {
      const n = Math.max(1, num(root.querySelector('[data-claim-count]')?.value))
      cl.disabled = true
      await guard(async () => {
        const res = await api.post('claim', { order_id: Number(id), count: n })
        toast(res.claimed ? t('claimed_ok', { n: res.claimed }) + (res.short ? t('claimed_short', { n: res.short }) : '') : t('waiting_stock'), res.claimed ? 'ok' : '')
        S.fresh = new Set(res.ids.map(String))
        for (const x of res.ids) S.selected.add(String(x))
        layer.close()
        nav.go('work')
      })
      cl.disabled = false
    }
  })
}

function claimRule() {
  const m = S.me?.timeout_minutes || 180
  const time = m % 1440 === 0 ? t('days', { n: m / 1440 }) : m % 60 ? t('minutes', { n: m }) : t('hours', { n: m / 60 })
  return t('claim_rule', { timeout: time })
}

async function replaceLink(linkId, after) {
  if (!(await confirm(t('replace'), t('replace_confirm'), { ok: t('replace'), cancel: t('cancel') }))) return
  await guard(async () => {
    const r = await api.post('replace', { id: Number(linkId) })
    toast(r.new_id ? t('replaced_ok') : t('replaced_wait'), 'ok')
    after?.()
  })
}
// ============ 待付款：跨页选择、复制、导出、放回 ============
/** 选中的（跨页保留选择；本页没有的按 id 去取） */
async function selectedLinks() {
  if (!S.selected.size) return []
  const all = await api.get('my_claimed', { page: 1, page_size: 500 })
  return all.links.filter((l) => S.selected.has(String(l.id)))
}

function txtOf(rows) {
  const time = new Date().toLocaleString()
  return `${t('txt_header', { n: rows.length, time })}\n\n${rows.map((r, i) => `${i + 1}. ${r.url}`).join('\n')}\n`
}

async function pendingAction(act) {
  if (act === 'copy-all') {
    const all = await api.get('my_claimed', { page: 1, page_size: 500, order_id: S.pending.order_id })
    const urls = all.links.filter((l) => l.status === 'claimed').map((l) => l.url)
    if (!urls.length) return toast(t('no_claimed'))
    await copy(urls.join('\n'))
    return toast(t('copied', { n: urls.length }), 'ok')
  }
  const rows = (await selectedLinks()).filter((l) => l.status === 'claimed')
  if (!rows.length) return toast(t('pick_links'))
  if (act === 'copy-sel') {
    await copy(rows.map((r) => r.url).join('\n'))
    return toast(t('copied', { n: rows.length }), 'ok')
  }
  if (act === 'txt') {
    const blob = new Blob([txtOf(rows)], { type: 'text/plain;charset=utf-8' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: t('txt_file', { n: rows.length, time: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') }) })
    a.click()
    return setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  if (act === 'release') {
    if (!(await confirm(t('release_selected'), t('release_confirm', { n: rows.length }), { ok: t('release_selected'), cancel: t('cancel'), danger: true }))) return
    const r = await api.post('release', { ids: rows.map((x) => Number(x.id)) })
    for (const x of rows) S.selected.delete(String(x.id))
    toast(t('released', { n: r.released }), 'ok')
    return viewWork()
  }
}

// ============ 已付款 ============
async function viewPaid() {
  const f = S.paid
  const r = await api.get('my_paid', { page: f.page, page_size: f.size, from: f.from, to: f.to })
  $('[data-section="paid"]').innerHTML = `<div class="card">
    <div class="toolbar">
      <div class="seg" role="group">
        ${[['', t('range_all')], ['today', t('range_today')], ['7d', t('range_7d')], ['30d', t('range_30d')]]
          .map(([v, label]) => `<button data-range="${v}" class="${(f.range ?? '') === v ? 'active' : ''}">${esc(label)}</button>`).join('')}
      </div>
      <label class="small text-2">${esc(t('from'))} <input type="date" data-df="from" value="${esc(f.from)}"></label>
      <label class="small text-2">${esc(t('to'))} <input type="date" data-df="to" value="${esc(f.to)}"></label>
      <span class="grow"></span>
      <span class="small text-2">${esc(t('paid_sum', { n: r.total, usd: usd(r.sum_usd), cny: cny(r.sum_cny) }))}</span>
      <a class="btn sm" href="api.php?action=export_paid&from=${encodeURIComponent(f.from)}&to=${encodeURIComponent(f.to)}&lang=${LANG}">${esc(t('export_csv'))}</a>
    </div>
    ${r.links.length ? `<div class="table-wrap"><table class="table stack"><thead><tr>
        <th>${esc(t('col_paid_at'))}</th><th>${esc(t('col_batch'))}</th><th class="right">${esc(t('col_amount'))}</th><th>${esc(t('col_link'))}</th>
      </tr></thead><tbody>${r.links.map((l) => `<tr>
        <td data-label="${esc(t('col_paid_at'))}" class="nowrap">${dt(l.paid_at)}</td>
        <td data-label="${esc(t('col_batch'))}">${l.code ? `<button class="link-btn" data-order="${l.order_id}">${esc(l.code)}</button>` : '-'}<div class="small muted">${esc(l.tier)}</div></td>
        <td data-label="${esc(t('col_amount'))}" class="right num">${usd(l.amount_due)}<div class="small muted">${cny(l.amount_cny)}</div></td>
        <td data-label="${esc(t('col_link'))}" class="url">${linkCell(l.url, { copyTitle: t('click_copy') })}</td>
      </tr>`).join('')}</tbody></table></div>` : empty(t('no_paid'))}
    <div class="pager" id="paid-pager"></div>
  </div>`
  pager($('#paid-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100], tt, onChange: (p, s) => { f.page = p; f.size = s; guard(viewPaid) } })
}

// ============ 结算记录 ============
function settlementsTable(rows, withOrder = true) {
  if (!rows.length) return empty(t('no_settlements'), t('no_settlements_tip'))
  return `<div class="table-wrap"><table class="table stack"><thead><tr>
      <th>${esc(t('col_time'))}</th>${withOrder ? `<th>${esc(t('col_batch'))}</th>` : ''}<th class="right">${esc(t('col_amount'))}</th>
      <th>${esc(t('col_network'))}</th><th>${esc(t('col_to'))}</th><th>${esc(t('col_tx'))}</th><th>${esc(t('col_proof'))}</th><th>${esc(t('col_note'))}</th>
    </tr></thead><tbody>${rows.map((s) => `<tr>
      <td data-label="${esc(t('col_time'))}" class="nowrap">${dt(s.paid_at)}</td>
      ${withOrder ? `<td data-label="${esc(t('col_batch'))}">${s.code ? `<button class="link-btn" data-order="${s.order_id}">${esc(s.code)}</button>` : '-'}</td>` : ''}
      <td data-label="${esc(t('col_amount'))}" class="right num"><b>${num(s.amount).toFixed(2)}</b> ${esc(s.token)}</td>
      <td data-label="${esc(t('col_network'))}">${esc(s.network_name)}</td>
      <td data-label="${esc(t('col_to'))}"><span class="mono" title="${esc(s.to_address)}">${esc(short(s.to_address))}</span></td>
      <td data-label="${esc(t('col_tx'))}">${txLink(s)}</td>
      <td data-label="${esc(t('col_proof'))}">${proofLink(s)}</td>
      <td data-label="${esc(t('col_note'))}" class="small text-2">${esc(s.note || '')}</td>
    </tr>`).join('')}</tbody></table></div>`
}

async function viewSettlements() {
  const f = S.settlements
  const [r] = await Promise.all([api.get('my_settlements', { page: f.page, page_size: f.size }), loadMe()])
  const s = S.me.stats
  $('[data-section="settlements"]').innerHTML = `
    <div class="stats">
      <div class="card stat"><span class="stat-label">${esc(t('stat_due'))}</span><span class="stat-value">${usd(s.due)}</span><span class="stat-sub">${esc(t('stat_due_sub'))}</span></div>
      <div class="card stat accent-ok"><span class="stat-label">${esc(t('stat_settled'))}</span><span class="stat-value">${usd(s.settled)}</span><span class="stat-sub">${esc(t('settle_records_n', { n: r.total }))}</span></div>
      <div class="card stat accent-warn"><span class="stat-label">${esc(t('stat_unsettled'))}</span><span class="stat-value">${usd(s.unsettled)}</span><span class="stat-sub">${esc(t('settle_rule'))}</span></div>
    </div>
    <div class="card"><div class="card-head"><h2>${esc(t('settlements_title'))}</h2></div>
      ${settlementsTable(r.settlements)}<div class="pager" id="settle-pager"></div></div>`
  pager($('#settle-pager'), { total: r.total, page: r.page, size: r.page_size, sizes: [20, 50, 100], tt, onChange: (p, sz) => { f.page = p; f.size = sz; guard(viewSettlements) } })
}
// ============ 收款设置 ============
async function viewWallet() {
  await loadMe()
  const c = S.me.client
  $('[data-section="wallet"]').innerHTML = `<div class="grid-2">
    <form class="card" id="wallet-form">
      <div class="card-head"><h2>${esc(t('wallet_title'))}</h2></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="form-grid">
          <label class="field"><span>${esc(t('wallet_network'))}</span>
            <select name="network">${S.me.networks.map((n) => `<option value="${n.id}" selected>${esc(n.name)}</option>`).join('')}</select>
            <span class="hint">${esc(t('polygon_only'))}</span></label>
          <label class="field"><span>${esc(t('wallet_token'))}</span>
            <select name="token">${S.me.tokens.map((k) => `<option ${k === c.wallet_token ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>${esc(t('wallet_address'))}</span>
          <input name="address" class="mono" value="${esc(c.wallet_network_ok ? c.wallet_address : '')}" placeholder="0x…" autocomplete="off" spellcheck="false" required>
          <span class="hint" id="addr-hint">${esc(t('wallet_address_hint'))}</span></label>
        <label class="field"><span>${esc(t('wallet_password'))}</span>
          <input name="password" type="password" autocomplete="current-password" required>
          <span class="hint">${esc(t('wallet_password_hint'))}</span></label>
        <div><button class="btn primary">${esc(t('save'))}</button></div>
      </div>
    </form>
    <div class="card">
      <div class="card-head"><h2>${esc(t('wallet_current'))}</h2></div>
      <div class="card-body">
        ${walletNotice()}
        ${c.wallet_address ? `<dl class="kv">
          <dt>${esc(t('wallet_network'))}</dt><dd>${esc(c.wallet_network_name)}</dd>
          <dt>${esc(t('wallet_token'))}</dt><dd>${esc(c.wallet_token)}</dd>
          <dt>${esc(t('wallet_address'))}</dt><dd><span class="mono">${esc(c.wallet_address)}</span> <button class="btn sm" type="button" data-copy="${esc(c.wallet_address)}">${esc(t('copy'))}</button></dd>
          <dt>${esc(t('wallet_updated'))}</dt><dd>${esc(c.wallet_updated_at || '-')}</dd>
        </dl>` : empty(t('wallet_missing'), t('wallet_missing_tip'))}
        <div class="callout warn" style="margin-top:16px"><div class="grow small">${esc(t('wallet_warning'))}</div></div>
      </div>
    </div>
  </div>`
  const form = $('#wallet-form')
  const F = (n) => form.querySelector(`[name="${n}"]`)
  const check = () => {
    const evm = F('network').value !== 'tron'
    const ok = evm ? /^0x[0-9a-fA-F]{40}$/.test(F('address').value.trim()) : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(F('address').value.trim())
    F('address').placeholder = evm ? '0x…' : 'T…'
    $('#addr-hint').textContent = !F('address').value || ok ? t('wallet_address_hint') : t('err_bad_address')
    $('#addr-hint').className = `hint ${F('address').value && !ok ? 'danger' : ''}`
    return ok
  }
  F('address').addEventListener('input', check)
  F('network').addEventListener('change', check)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!check()) return toast(t('err_bad_address'), 'error')
    guard(async () => {
      await api.post('wallet_save', { network: F('network').value, token: F('token').value, address: F('address').value.trim(), password: F('password').value })
      toast(t('wallet_saved'), 'ok')
      viewWallet()
    })
  })
}

// ============ 路由 / 事件 / 刷新 ============
const VIEWS = { work: viewWork, orders: viewOrders, paid: viewPaid, settlements: viewSettlements, wallet: viewWallet }
const TITLES = { work: 'nav_work', orders: 'nav_orders', paid: 'nav_paid', settlements: 'nav_settlements', wallet: 'nav_wallet' }
function render() {
  $('#page-title').textContent = t(TITLES[S.view])
  return guard(VIEWS[S.view])
}
const nav = UI.mountNav({ onChange: (v) => { S.view = v; render() } })

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]')
  if (go) return nav.go(go.dataset.goto)
  if (e.target.closest('.drawer, .modal')) return
  const ord = e.target.closest('[data-order]')
  if (ord && !e.target.closest('input, a')) return guard(() => openOrder(ord.dataset.order))
  const c = e.target.closest('[data-copy]')
  if (c) return copy(c.dataset.copy).then(() => toast(t('copied', { n: 1 }), 'ok'))
  const rep = e.target.closest('[data-replace]')
  if (rep) return replaceLink(rep.dataset.replace, render)
  if (e.target.closest('[data-reload]')) return render()
  const cn = e.target.closest('[data-claim-now]')
  if (cn) return claimFrom(cn)
  const rg = e.target.closest('[data-range]')
  if (rg) {
    const v = rg.dataset.range
    const day = (d) => new Date(Date.now() + d * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10)
    Object.assign(S.paid, {
      range: v,
      from: v === 'today' ? day(0) : v === '7d' ? day(-6) : v === '30d' ? day(-29) : '',
      to: v ? day(0) : '',
      page: 1
    })
    return render()
  }
  const pa = e.target.closest('[data-pa]')
  if (pa) return guard(() => pendingAction(pa.dataset.pa))
  const sf = e.target.closest('[data-f][data-v]')
  if (sf) { S.orders[sf.dataset.f] = sf.dataset.v; S.orders.page = 1; return render() }
})
document.addEventListener('change', (e) => {
  const el = e.target
  if (el.matches('[data-sel]')) {
    el.checked ? S.selected.add(el.dataset.sel) : S.selected.delete(el.dataset.sel)
    $('#sel-info').textContent = t('selected_n', { n: S.selected.size })
  } else if (el.matches('[data-check-all]')) {
    for (const l of S.pendingRows) if (l.status === 'claimed') el.checked ? S.selected.add(String(l.id)) : S.selected.delete(String(l.id))
    render()
  } else if (el.matches('select[data-f]')) {
    S.orders[el.dataset.f] = el.value; S.orders.page = 1; render()
  } else if (el.matches('[data-pf]')) {
    S.pending.order_id = el.value; S.pending.page = 1; render()
  } else if (el.matches('[data-df]')) {
    S.paid[el.dataset.df] = el.value; S.paid.range = ''; S.paid.page = 1; render()
  }
})
$('#logout').addEventListener('click', async () => {
  await fetch('api.php?action=logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
})
document.addEventListener('langchange', render)

// 自动刷新：只刷概览 / 批次 / 待付款；开着抽屉、正在输入、页面在后台时不刷
setInterval(() => {
  if (document.hidden || S.drawer || document.querySelector('.modal')) return
  if (document.activeElement?.matches?.('input, select, textarea')) return
  if (['work', 'orders'].includes(S.view)) render()
  else guard(loadMe)
}, 10000)

S.view = nav.initial
guard(loadMe).then(() => nav.go(S.view, false))
