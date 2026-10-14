// 客户页面：每 3 秒拉一次状态；领取 / 复制 / 导出 TXT / 放回 / 导出对账
const app = document.querySelector('.app')
const csrf = app.dataset.csrf
const $ = (id) => document.getElementById(id)

let state = null

const selected = new Set()

async function api(action, body) {
  const res = await fetch(`api.php?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  })
  if (res.status === 401) {
    location.reload()
    throw new Error(t('err_login_required'))
  }
  const data = await res.json().catch(() => ({ ok: false }))
  if (!data.ok) throw new Error(tError(data, 'network_error'))
  return data
}

function toast(text) {
  const el = $('toast')
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200)
}

const usd = (v) => (v == null ? '-' : `$${Number(v).toFixed(2)}`)
const cny = (v) => (v == null ? '' : `≈ ¥${Number(v).toFixed(2)}`)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function range(min, max, fmt) {
  if (min == null) return ''
  return Math.abs(Number(max) - Number(min)) < 0.01 ? fmt(min) : `${fmt(min)} ~ ${fmt(max).replace(/^≈ /, '')}`
}

function left(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? t('left_hm', { h, m }) : t('left_m', { m })
}

// ============ 渲染 ============

/** 批次号 → 批次，表格里的批次列用它显示批次号 */
function orderCode(id) {
  return state.orders.find((o) => String(o.id) === String(id))?.code || '-'
}

// 点开的批次：id → 明细（每 3 秒刷新状态时一起重拉）
const openOrders = new Map()

async function loadOrderLinks(id) {
  const r = await api(`order_links&order_id=${encodeURIComponent(id)}`)
  openOrders.set(String(id), r.links)
}

function orderDetail(o) {
  const rows = openOrders.get(String(o.id))
  if (!rows) return `<div class="order-detail muted small">${t('loading')}</div>`
  const unpaid = rows.filter((r) => r.status === 'claimed')
  return `<div class="order-detail">
    ${unpaid.length ? `<button class="btn small-btn" data-copy-order="${o.id}">${t('copy_unpaid', { n: unpaid.length })}</button>` : ''}
    <div class="table-wrap"><table><tbody>${rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td><span class="tag ${r.status === 'paid' ? 'ok' : ''}">${t(`link_${r.status}`)}</span></td>
      <td>${usd(r.amount_due)} <span class="muted small">${cny(r.amount_cny)}</span></td>
      <td class="url">${r.url ? esc(r.url) : `<span class="muted small">${t('void_hint')}</span>`}</td>
      <td class="small">${esc(String(r.paid_at || r.claimed_at || '').slice(5, 16))}</td>
    </tr>`).join('')}</tbody></table></div>
  </div>`
}

/** 我的批次：进行中的可以领；数量框默认填满剩余额度 */
function renderOrders() {
  const orders = state.orders
  if (!orders.length) {
    $('orders').innerHTML = `<p class="muted">${t('no_orders')}</p>`
    return
  }
  // 数量框正在输入时不重画，免得每 3 秒把用户输入冲掉
  const typing = document.activeElement?.matches?.('input[data-count]')
  if (typing) return
  $('orders').innerHTML = orders.map((o) => {
    const open = o.status === 'open'
    const remaining = Number(o.remaining)
    const badge = open ? '' : `<span class="tag ${o.status === 'done' ? 'ok' : ''}">${t(o.status === 'done' ? 'order_done' : 'order_cancelled')}</span>`
    const pct = Math.min(100, Math.round((Number(o.paid) / Math.max(1, Number(o.quantity))) * 100))
    const offline = o.source === 'offline'
    const expanded = openOrders.has(String(o.id))
    const progress = offline
      ? t('order_progress_offline', { paid: Number(o.paid), qty: o.quantity, holding: Number(o.holding), void: Number(o.void || 0) })
      : t('order_progress', { paid: Number(o.paid), qty: o.quantity, holding: Number(o.holding), remaining })
    return `<div class="order ${open ? '' : 'closed'}">
      <button class="order-head order-toggle" data-toggle-order="${o.id}" aria-expanded="${expanded}">
        <b>${esc(o.code)}</b><span class="badge">${esc(o.tier)} × ${o.quantity}</span>${badge}
        <span class="muted small">${o.note ? esc(o.note) : ''}</span><span class="spacer"></span>
        <span class="small">${t(expanded ? 'hide_links' : 'view_links')}</span>
      </button>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="muted small">${progress}${offline ? '' : ` · ${t('order_replaced', { used: o.replaced, limit: o.replace_limit })}`}</div>
      ${expanded ? orderDetail(o) : ''}
      ${open && !offline && remaining > 0 ? `<div class="order-claim">
        <input type="number" min="1" max="${remaining}" value="${remaining}" data-count="${o.id}" aria-label="${esc(t('count'))}">
        <button class="btn primary" data-claim="${o.id}">${t('claim')}</button>
      </div>` : ''}
    </div>`
  }).join('')
}

function renderClaimed() {
  const rows = state.claimed
  const alive = new Set(rows.map((r) => String(r.id)))
  for (const id of [...selected]) if (!alive.has(id)) selected.delete(id)
  $('claimed').innerHTML = rows.map((r, i) => {
    const checking = r.status === 'checking'
    const soon = !checking && r.expires_in < 15 * 60
    return `<tr class="${checking ? 'checking' : ''} ${soon ? 'soon' : ''}">
      <td><input type="checkbox" data-id="${r.id}" ${selected.has(String(r.id)) ? 'checked' : ''} ${checking ? 'disabled' : ''} aria-label="${esc(t('select_row', { n: i + 1 }))}"></td>
      <td>${i + 1}</td>
      <td class="small">${esc(r.claim_batch || orderCode(r.order_id))}</td>
      <td>${esc(r.tier)}<br><span class="muted small">${usd(r.amount_due)} ${cny(r.amount_cny)}</span></td>
      <td class="url">${esc(r.url)}</td>
      <td class="time small">${checking ? `<span class="tag">${t('checking')}</span>` : left(r.expires_in)}</td>
      <td>${checking || !r.order_id ? '' : `<button class="btn small-btn" data-replace="${r.id}">${t('replace')}</button>`}</td>
    </tr>`
  }).join('')
  $('claimed-empty').style.display = rows.length ? 'none' : ''
  $('claimed-count').textContent = rows.length
  $('selected').textContent = t('selected_n', { n: selected.size })
  const open = rows.filter((r) => r.status === 'claimed')
  $('check-all').checked = open.length > 0 && open.every((r) => selected.has(String(r.id)))
}

function renderPaid() {
  const rows = state.paid
  $('paid').innerHTML = rows.map((r, i) => `<tr>
      <td>${state.paid_total - i}</td>
      <td class="small">${esc(r.claim_batch || orderCode(r.order_id))}</td>
      <td>${esc(r.tier)}<br><span class="muted small">${usd(r.amount_due)} ${cny(r.amount_cny)}</span></td>
      <td class="url">${esc(r.url)}</td>
      <td class="small">${esc(String(r.paid_at).slice(5, 16))}</td>
    </tr>`).join('')
  $('paid-empty').style.display = rows.length ? 'none' : ''
  $('paid-count').textContent = state.paid_total
  $('daily').innerHTML = state.daily.map((d) => `<span>${esc(t('daily_item', { day: String(d.day).slice(5), n: d.n }))}</span>`).join('')
}

function render() {
  // 可领取 = 自己进行中批次的剩余额度（不再显示公共池子有多少）
  const available = state.orders.filter((o) => o.status === 'open').reduce((n, o) => n + Number(o.remaining), 0)
  const today = state.daily.find((d) => d.day === state.now.slice(0, 10))
  $('stat-available').textContent = available
  $('stat-claimed').textContent = state.claimed.length
  $('stat-paid').textContent = state.paid_total
  $('stat-today').textContent = today ? today.n : 0
  $('updated').textContent = t('updated_at', { time: state.now.slice(11) })
  $('who').textContent = state.client?.display_name || state.client?.username || ''
  const m = state.timeout_minutes
  const timeout = m % 60 ? t('minutes', { n: m }) : t('hours', { n: m / 60 })
  $('claim-rule').textContent = t('claim_rule', { timeout })

  renderOrders()
  renderClaimed()
  renderPaid()
}

async function refresh() {
  try {
    state = await api('state')
    // 点开着的批次跟着刷新状态
    await Promise.all([...openOrders.keys()].map((id) => loadOrderLinks(id).catch(() => openOrders.delete(id))))
    render()
  } catch (e) {
    $('updated').textContent = t('refresh_failed', { msg: e.message })
  }
}

// ============ 交互 ============

// 批次卡片里的「领取」：在该批次额度内领，数量框默认填满剩余额度
// 点批次标题：展开 / 收起这个批次的全部链接
$('orders').addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle-order]')
  if (toggle) {
    const id = toggle.dataset.toggleOrder
    if (openOrders.has(id)) {
      openOrders.delete(id)
      return renderOrders()
    }
    openOrders.set(id, null)
    renderOrders()
    try {
      await loadOrderLinks(id)
    } catch (err) {
      openOrders.delete(id)
      toast(err.message)
    }
    return renderOrders()
  }
  const copyBtn = e.target.closest('[data-copy-order]')
  if (copyBtn) {
    const urls = (openOrders.get(copyBtn.dataset.copyOrder) || []).filter((r) => r.status === 'claimed').map((r) => r.url)
    if (!urls.length) return
    await copy(urls.join('\n'))
    toast(t('copied', { n: urls.length }))
    return
  }
  const btn = e.target.closest('[data-claim]')
  if (!btn) return
  const orderId = Number(btn.dataset.claim)
  const input = document.querySelector(`input[data-count="${orderId}"]`)
  const count = Math.max(1, Number(input?.value) || 1)
  btn.disabled = true
  try {
    const res = await api('claim', { order_id: orderId, count })
    for (const id of res.ids) selected.add(String(id))
    const short = res.short ? t('claimed_short', { n: res.short }) : ''
    $('claim-msg').textContent = res.claimed
      ? t('claimed_ok', { n: res.claimed }) + short
      : t('waiting_stock')
    await refresh()
  } catch (err) {
    toast(err.message)
  } finally {
    btn.disabled = false
  }
})

// 待付款行里的「更换」：当前链接作废，补一条新的进同一批次
$('claimed').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-replace]')
  if (!btn) return
  if (!confirm(t('replace_confirm'))) return
  btn.disabled = true
  try {
    const res = await api('replace', { id: Number(btn.dataset.replace) })
    selected.delete(btn.dataset.replace)
    if (res.new_id) selected.add(String(res.new_id))
    toast(res.new_id ? t('replaced_ok') : t('replaced_wait'))
    await refresh()
  } catch (err) {
    toast(err.message)
    btn.disabled = false
  }
})

$('claimed').addEventListener('change', (e) => {
  const box = e.target.closest('input[data-id]')
  if (!box) return
  if (box.checked) selected.add(box.dataset.id)
  else selected.delete(box.dataset.id)
  renderClaimed()
})

$('check-all').addEventListener('change', (e) => {
  for (const r of state.claimed) {
    if (r.status !== 'claimed') continue
    if (e.target.checked) selected.add(String(r.id))
    else selected.delete(String(r.id))
  }
  renderClaimed()
})

function chosen() {
  return state.claimed.filter((r) => selected.has(String(r.id)))
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return {
    file: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`,
    text: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
}

function downloadTxt(list) {
  const s = stamp()
  const header = `${t('txt_header', { n: list.length, time: s.text })}\n\n`
  const text = header + list.map((r, i) => `${i + 1}. ${r.url}`).join('\n') + '\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  a.download = t('txt_file', { n: list.length, time: s.file })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function release(list) {
  if (!confirm(t('release_confirm', { n: list.length }))) return
  try {
    const res = await api('release', { ids: list.map((r) => Number(r.id)) })
    for (const r of list) selected.delete(String(r.id))
    toast(t('released', { n: res.released }))
    await refresh()
  } catch (err) {
    toast(err.message)
  }
}

document.querySelector('.col-head .actions').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act
  if (!act) return
  if (act === 'select-all') {
    for (const r of state.claimed) if (r.status === 'claimed') selected.add(String(r.id))
    return renderClaimed()
  }
  if (act === 'select-none') {
    selected.clear()
    return renderClaimed()
  }
  const list = chosen()
  if (!list.length) return toast(t('pick_links'))
  if (act === 'copy') {
    await copy(list.map((r) => r.url).join('\n'))
    return toast(t('copied', { n: list.length }))
  }
  if (act === 'txt') return downloadTxt(list)
  if (act === 'release') return release(list)
})

$('export-paid').addEventListener('click', () => {
  const q = new URLSearchParams({ action: 'export_paid', lang: LANG })
  if ($('from').value) q.set('from', $('from').value)
  if ($('to').value) q.set('to', $('to').value)
  location.href = `api.php?${q}`
})

$('logout').addEventListener('click', async () => {
  await fetch('api.php?action=logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
})

// 切换语言：静态文字由 i18n.js 换掉，这里重画动态部分
document.addEventListener('langchange', () => state && render())

refresh()
setInterval(() => {
  if (document.visibilityState === 'visible') refresh()
}, 3000)