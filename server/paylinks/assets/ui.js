// 共用前端小工具：客户门户（portal.js）与管理后台（admin.js）都用。无依赖。
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const num = (v) => Number(v ?? 0) || 0
  const usd = (v) => `$${num(v).toFixed(2)}`
  const cny = (v) => `¥${num(v).toFixed(2)}`
  const amount = (v, token) => `${num(v).toFixed(2)} ${esc(token || '')}`.trim()
  /** 2026-10-14 08:20:36 → 10-14 08:20 */
  const dt = (v) => (v ? String(v).slice(5, 16) : '-')
  const day = (v) => (v ? String(v).slice(0, 10) : '-')
  /** 0x1234…abcd */
  const short = (s, head = 6, tail = 4) => (s && s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s || '')

  // ============ 提示 ============
  function toast(text, kind = '') {
    let stack = $('.toast-stack')
    if (!stack) {
      stack = Object.assign(document.createElement('div'), { className: 'toast-stack' })
      stack.setAttribute('role', 'status')
      stack.setAttribute('aria-live', 'polite')
      document.body.append(stack)
    }
    const el = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: text })
    stack.append(el)
    setTimeout(() => el.remove(), kind === 'error' ? 4500 : 2600)
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

  // ============ 抽屉 / 弹窗 ============
  // 打开时记住焦点，关闭时还回去；Esc 关闭；同时只开一个抽屉、一个弹窗
  const layers = []
  function openLayer(kind, html, { onClose, wide } = {}) {
    const back = document.activeElement
    const overlay = Object.assign(document.createElement('div'), { className: `overlay ${kind === 'modal' ? 'top' : ''}` })
    const box = document.createElement('div')
    box.className = kind === 'modal' ? `modal ${wide ? 'wide' : ''}` : 'drawer'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.innerHTML = html
    document.body.append(overlay, box)
    const layer = {
      el: box,
      close() {
        overlay.remove()
        box.remove()
        layers.splice(layers.indexOf(layer), 1)
        onClose?.()
        back?.focus?.()
      }
    }
    layers.push(layer)
    overlay.addEventListener('click', () => layer.close())
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) layer.close()
    })
    setTimeout(() => (box.querySelector('[autofocus], input, select, textarea, button:not([data-close])') || box).focus?.(), 30)
    return layer
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layers.length) layers[layers.length - 1].close()
  })
  const closeBtn = (label) => `<button class="btn ghost close-btn" data-close aria-label="${esc(label)}">✕</button>`
  function drawer(title, body, { foot = '', closeLabel = 'Close', onClose } = {}) {
    return openLayer('drawer', `<div class="drawer-head"><h2>${title}</h2>${closeBtn(closeLabel)}</div>
      <div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ''}`, { onClose })
  }
  function modal(title, body, { foot = '', closeLabel = 'Close', wide, onClose } = {}) {
    return openLayer('modal', `<div class="modal-head"><h2>${title}</h2>${closeBtn(closeLabel)}</div>
      <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`, { wide, onClose })
  }
  /** 确认框：返回 Promise<boolean> */
  function confirm(title, text, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false
      const layer = modal(esc(title), `<p class="text-2" style="margin:0">${esc(text)}</p>`, {
        foot: `<button class="btn" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
        onClose: () => !done && resolve(false)
      })
      layer.el.querySelector('[data-ok]').addEventListener('click', () => {
        done = true
        layer.close()
        resolve(true)
      })
    })
  }

  // ============ 分页 ============
  /**
   * 画分页条。tt：文案函数（key, params）→ 文本，门户传 i18n 的 t，后台传中文。
   * keys：pager_info（{from,to,total}）、pager_prev、pager_next、pager_size（{n}）
   */
  function pager(el, { total, page, size, sizes = [10, 20, 50, 100], tt, onChange }) {
    const pages = Math.max(1, Math.ceil(total / size))
    const from = total ? (page - 1) * size + 1 : 0
    const to = Math.min(total, page * size)
    // 页码：首尾 + 当前前后两页，中间用省略号
    const nums = []
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i)
      else if (nums[nums.length - 1] !== '…') nums.push('…')
    }
    el.innerHTML = `<span class="info">${esc(tt('pager_info', { from, to, total }))}</span>
      <select aria-label="${esc(tt('pager_size', { n: size }))}">${sizes.map((s) => `<option value="${s}" ${s === size ? 'selected' : ''}>${esc(tt('pager_size', { n: s }))}</option>`).join('')}</select>
      <span class="pages">
        <button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="${esc(tt('pager_prev'))}">‹</button>
        ${nums.map((n) => (n === '…' ? '<button disabled>…</button>' : `<button data-p="${n}" class="${n === page ? 'active' : ''}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}
        <button data-p="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="${esc(tt('pager_next'))}">›</button>
      </span>`
    el.onclick = (e) => {
      const b = e.target.closest('button[data-p]')
      if (b && !b.disabled) onChange(Number(b.dataset.p), size)
    }
    el.querySelector('select').onchange = (e) => onChange(1, Number(e.target.value))
  }

  // ============ 请求 ============
  /** fetch 封装：带 CSRF，401 回登录页；失败抛 Error（message 用 errText 翻译） */
  function client({ csrf, errText = (d) => d?.error || 'Request failed' }) {
    async function send(url, init) {
      const res = await fetch(url, { credentials: 'same-origin', ...init })
      if (res.status === 401) {
        location.reload()
        throw new Error('login required')
      }
      const data = await res.json().catch(() => ({ ok: false }))
      if (!data.ok) throw new Error(errText(data))
      return data
    }
    return {
      get: (action, params = {}) => {
        const q = new URLSearchParams({ action })
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v)
        return send(`api.php?${q}`, { headers: { 'X-CSRF-Token': csrf } })
      },
      post: (action, body) =>
        send(`api.php?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) }),
      form: (action, formData) => send(`api.php?action=${action}`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: formData })
    }
  }

  async function guard(fn) {
    try {
      return await fn()
    } catch (e) {
      if (e.message !== 'login required') toast(e.message, 'error')
    }
  }

  /** 侧栏导航：data-view 切换 section；手机上点完收起 */
  function mountNav({ onChange }) {
    const shell = $('.shell')
    $('.menu-btn')?.addEventListener('click', () => shell.classList.toggle('nav-open'))
    $('.nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]')
      if (!b) return
      go(b.dataset.view)
    })
    function go(view, push = true) {
      for (const b of $$('.nav [data-view]')) b.classList.toggle('active', b.dataset.view === view)
      for (const s of $$('[data-section]')) s.hidden = s.dataset.section !== view
      shell.classList.remove('nav-open')
      if (push) history.replaceState(null, '', `#${view}`)
      onChange(view)
    }
    const first = location.hash.slice(1)
    return { go, initial: $(`.nav [data-view="${first}"]`) ? first : $('.nav [data-view]').dataset.view }
  }

  return { $, $$, esc, num, usd, cny, amount, dt, day, short, toast, copy, drawer, modal, confirm, pager, client, guard, mountNav }
})()
