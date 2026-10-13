// 客户页面：每 3 秒拉一次状态；领取 / 复制 / 导出 TXT / 放回 / 导出对账
const app = document.querySelector('.app')
const csrf = app.dataset.csrf
const $ = (id) => document.getElementById(id)

let state = null
let tier = localStorage.getItem('pl.tier') || ''
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
    throw new Error('登录已过期')
  }
  const data = await res.json().catch(() => ({ ok: false, error: '服务器返回异常' }))
  if (!data.ok) throw new Error(data.error || '操作失败')
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
  return h ? `${h} 小时 ${m} 分` : `${m} 分钟`
}

// ============ 渲染 ============

function renderTiers() {
  const tiers = state.tiers
  if (!tiers.some((t) => t.tier === tier)) tier = tiers[0]?.tier || ''
  $('tiers').innerHTML = tiers.length
    ? tiers.map((t) => `
      <button type="button" role="radio" aria-checked="${t.tier === tier}" class="tier ${t.tier === tier ? 'selected' : ''}" data-tier="${esc(t.tier)}">
        <span class="name">${esc(t.tier)}</span>
        <span class="price">${range(t.min_usd, t.max_usd, usd)}</span>
        <span class="cny">${range(t.min_cny, t.max_cny, cny)}</span>
        <span class="left">可领 ${t.n} 条${t.list_price ? ` · 原价 $${Number(t.list_price).toFixed(0)}/月` : ''}</span>
      </button>`).join('')
    : `<p class="muted">暂时没有可领取的链接${state.refreshing ? `（${state.refreshing} 条正在换新链接）` : ''}</p>`
}

function renderClaimed() {
  const rows = state.claimed
  const alive = new Set(rows.map((r) => String(r.id)))
  for (const id of [...selected]) if (!alive.has(id)) selected.delete(id)
  $('claimed').innerHTML = rows.map((r, i) => {
    const checking = r.status === 'checking'
    const soon = !checking && r.expires_in < 15 * 60
    return `<tr class="${checking ? 'checking' : ''} ${soon ? 'soon' : ''}">
      <td><input type="checkbox" data-id="${r.id}" ${selected.has(String(r.id)) ? 'checked' : ''} ${checking ? 'disabled' : ''} aria-label="选择第 ${i + 1} 条"></td>
      <td>${i + 1}</td>
      <td>${esc(r.tier)}<br><span class="muted small">${usd(r.amount_due)} ${cny(r.amount_cny)}</span></td>
      <td class="url">${esc(r.url)}</td>
      <td class="time small">${checking ? '<span class="tag">确认付款中</span>' : left(r.expires_in)}</td>
    </tr>`
  }).join('')
  $('claimed-empty').style.display = rows.length ? 'none' : ''
  $('claimed-count').textContent = rows.length
  $('selected').textContent = `已选 ${selected.size}`
  const open = rows.filter((r) => r.status === 'claimed')
  $('check-all').checked = open.length > 0 && open.every((r) => selected.has(String(r.id)))
}

function renderPaid() {
  const rows = state.paid
  $('paid').innerHTML = rows.map((r, i) => `<tr>
      <td>${state.paid_total - i}</td>
      <td>${esc(r.tier)}<br><span class="muted small">${usd(r.amount_due)} ${cny(r.amount_cny)}</span></td>
      <td class="url">${esc(r.url)}</td>
      <td class="small">${esc(String(r.paid_at).slice(5, 16))}</td>
    </tr>`).join('')
  $('paid-empty').style.display = rows.length ? 'none' : ''
  $('paid-count').textContent = state.paid_total
  $('daily').innerHTML = state.daily.map((d) => `<span>${esc(String(d.day).slice(5))}：${d.n} 条</span>`).join('')
}

function render() {
  const available = state.tiers.reduce((n, t) => n + Number(t.n), 0)
  const today = state.daily.find((d) => d.day === state.now.slice(0, 10))
  $('stat-available').textContent = available
  $('stat-claimed').textContent = state.claimed.length
  $('stat-paid').textContent = state.paid_total
  $('stat-today').textContent = today ? today.n : 0
  $('updated').textContent = `更新于 ${state.now.slice(11)}`
  const m = state.timeout_minutes
  $('timeout-text').textContent = m % 60 ? `${m} 分钟` : `${m / 60} 小时`
  $('count').max = state.max_claim
  renderTiers()
  renderClaimed()
  renderPaid()
}

async function refresh() {
  try {
    state = await api('state')
    render()
  } catch (e) {
    $('updated').textContent = `刷新失败：${e.message}`
  }
}

// ============ 交互 ============

$('tiers').addEventListener('click', (e) => {
  const btn = e.target.closest('.tier')
  if (!btn) return
  tier = btn.dataset.tier
  localStorage.setItem('pl.tier', tier)
  renderTiers()
})

$('claim').addEventListener('click', async () => {
  const count = Math.max(1, Math.min(Number($('count').value) || 1, state?.max_claim || 50))
  if (!tier) return toast('请先选择档位')
  $('claim').disabled = true
  try {
    const res = await api('claim', { tier, count })
    for (const link of res.links) selected.add(String(link.id))
    const short = res.short ? `（库存不足，少 ${res.short} 条）` : ''
    $('claim-msg').textContent = `已领取 ${res.links.length} 条${short}，已自动选中，可直接复制`
    await refresh()
  } catch (e) {
    toast(e.message)
  } finally {
    $('claim').disabled = false
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
  const header = `# 代付付款链接　共 ${list.length} 条　导出于 ${s.text}\n# 每条前面是序号，一行一个链接；按序号逐个打开付款即可。\n\n`
  const text = header + list.map((r, i) => `${i + 1}. ${r.url}`).join('\n') + '\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  a.download = `代付链接_共${list.length}条_${s.file}.txt`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

async function release(list) {
  if (!confirm(`放回 ${list.length} 条链接？放回后这些链接作废，系统会换成新链接重新上架。`)) return
  try {
    const res = await api('release', { ids: list.map((r) => Number(r.id)) })
    for (const r of list) selected.delete(String(r.id))
    toast(`已放回 ${res.released} 条`)
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
  if (!list.length) return toast('请先勾选链接')
  if (act === 'copy') {
    await copy(list.map((r) => r.url).join('\n'))
    return toast(`已复制 ${list.length} 条链接`)
  }
  if (act === 'txt') return downloadTxt(list)
  if (act === 'release') return release(list)
})

$('export-paid').addEventListener('click', () => {
  const q = new URLSearchParams({ action: 'export_paid' })
  if ($('from').value) q.set('from', $('from').value)
  if ($('to').value) q.set('to', $('to').value)
  location.href = `api.php?${q}`
})

$('logout').addEventListener('click', async () => {
  await fetch('api.php?action=logout', { method: 'POST', credentials: 'same-origin' })
  location.reload()
})

refresh()
setInterval(() => {
  if (document.visibilityState === 'visible') refresh()
}, 3000)