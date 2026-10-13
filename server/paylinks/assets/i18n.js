// 网页文案：中文 / English / O'zbekcha。页面上 data-i18n="key" 的元素按当前语言替换文字，
// data-i18n-ph 替换 placeholder；脚本里用 t('key', {n: 3}) 取带参数的文案。
// 三种语言的 key 必须一一对应；缺的 key 回落到中文。
const I18N = {}

I18N.zh = {
  title: '支付链接',
  login_hint: '请登录后领取链接',
  username: '账号',
  password: '密码',
  login: '登录',
  logout: '退出登录',
  auto_refresh: '每 3 秒自动刷新',
  loading: '加载中…',
  updated_at: '更新于 {time}',
  refresh_failed: '刷新失败：{msg}',
  stat_available: '可领取',
  stat_claimed: '待付款',
  stat_paid: '已付款（累计）',
  stat_today: '今日已付',
  claim_title: '领取链接',
  count: '数量',
  claim: '领取',
  claim_rule: '领走的链接只有你看得到；{timeout}内没付款会自动收回并换成新链接，旧链接作废。',
  hours: '{n} 小时',
  minutes: '{n} 分钟',
  pending_title: '待付款',
  select_all: '全选',
  select_none: '清空选择',
  copy_selected: '复制所选',
  export_txt: '导出所选 TXT',
  release_selected: '放回所选',
  selected_n: '已选 {n}',
  col_tier: '档位 / 金额',
  col_link: '支付链接',
  col_left: '剩余时间',
  col_paid_at: '付款时间',
  no_claimed: '还没有领取链接',
  paid_title: '已付款',
  from: '从',
  to: '到',
  export_csv: '导出对账 CSV',
  no_paid: '还没有已付款的链接',
  available_n: '可领 {n} 条',
  list_price: '原价 ${n}/月',
  no_stock: '暂时没有可领取的链接',
  refreshing_n: '（{n} 条正在换新链接）',
  checking: '确认付款中',
  left_hm: '{h} 小时 {m} 分',
  left_m: '{m} 分钟',
  pick_tier: '请先选择档位',
  claimed_ok: '已领取 {n} 条，已自动选中，可直接复制',
  claimed_short: '（库存不足，少 {n} 条）',
  pick_links: '请先勾选链接',
  copied: '已复制 {n} 条链接',
  release_confirm: '放回 {n} 条链接？放回后这些链接作废，系统会换成新链接重新上架。',
  released: '已放回 {n} 条',
  daily_item: '{day}：{n} 条',
  select_row: '选择第 {n} 条',
  txt_header: '# 代付付款链接　共 {n} 条　导出于 {time}\n# 每条前面是序号，一行一个链接；按序号逐个打开付款即可。',
  txt_file: '代付链接_共{n}条_{time}.txt',
  network_error: '网络错误，请重试',
  login_failed: '登录失败',
  // 服务器错误码
  err_login_required: '请先登录',
  err_csrf: '页面已过期，请刷新',
  err_bad_credentials: '账号或密码不正确',
  err_disabled: '账号已停用，请联系管理员',
  err_too_many_attempts: '尝试次数过多，请 15 分钟后再试',
  err_tier_required: '请选择档位',
  err_out_of_stock: '这个档位暂时没有可领取的链接',
  err_nothing_selected: '请选择要放回的链接',
  orders_title: "我的批次",
  no_orders: "还没有派给你的批次，需要时管理员会派单",
  order_progress: "已付 {paid} / {qty} · 待付 {holding} · 可领 {remaining}",
  order_replaced: "已更换 {used} / {limit} 次",
  order_done: "已完成",
  order_cancelled: "已取消",
  claim_n: "领取 {n} 条",
  col_batch: "批次",
  replace: "更换",
  replace_confirm: "更换这条链接？当前链接作废，补一条新的（不占批次额度）。",
  replaced_ok: "已更换",
  replaced_wait: "已作废，新链接还在准备，稍后在批次里点领取",
  waiting_stock: "链接准备中，稍等片刻再领取",
  err_too_fast: "操作太快了，请稍等几秒再试",
  err_order_required: "请先选择批次",
  err_order_not_found: "批次不存在",
  err_order_closed: "这个批次已经结束",
  err_order_full: "这个批次的额度已经领完了",
  err_cannot_replace: "这条链接不能更换",
  err_replace_limit: "这个批次的更换次数已经用完，请联系管理员",
  search: "搜索链接",
  export_fields: "导出字段"
}
I18N.en = {
  title: 'Payment links',
  login_hint: 'Sign in to claim links',
  username: 'Username',
  password: 'Password',
  login: 'Sign in',
  logout: 'Sign out',
  auto_refresh: 'Auto-refreshes every 3 seconds',
  loading: 'Loading…',
  updated_at: 'Updated {time}',
  refresh_failed: 'Refresh failed: {msg}',
  stat_available: 'Available',
  stat_claimed: 'Awaiting payment',
  stat_paid: 'Paid (total)',
  stat_today: 'Paid today',
  claim_title: 'Claim links',
  count: 'Quantity',
  claim: 'Claim',
  claim_rule: 'Claimed links are visible only to you. If unpaid within {timeout}, they are taken back and replaced with new links; the old links stop working.',
  hours: '{n} hours',
  minutes: '{n} minutes',
  pending_title: 'Awaiting payment',
  select_all: 'Select all',
  select_none: 'Clear selection',
  copy_selected: 'Copy selected',
  export_txt: 'Export selected TXT',
  release_selected: 'Return selected',
  selected_n: '{n} selected',
  col_tier: 'Plan / amount',
  col_link: 'Payment link',
  col_left: 'Time left',
  col_paid_at: 'Paid at',
  no_claimed: 'No claimed links yet',
  paid_title: 'Paid',
  from: 'From',
  to: 'To',
  export_csv: 'Export CSV statement',
  no_paid: 'No paid links yet',
  available_n: '{n} available',
  list_price: 'List ${n}/mo',
  no_stock: 'No links available right now',
  refreshing_n: ' ({n} being replaced with new links)',
  checking: 'Confirming payment',
  left_hm: '{h} h {m} min',
  left_m: '{m} min',
  pick_tier: 'Choose a plan first',
  claimed_ok: 'Claimed {n} links and selected them, ready to copy',
  claimed_short: ' (not enough stock, {n} short)',
  pick_links: 'Select some links first',
  copied: 'Copied {n} links',
  release_confirm: 'Return {n} links? They will stop working and be replaced with new links.',
  released: 'Returned {n} links',
  daily_item: '{day}: {n}',
  select_row: 'Select row {n}',
  txt_header: '# Payment links — {n} in total — exported {time}\n# One link per line, numbered; open and pay them in order.',
  txt_file: 'payment-links_{n}_{time}.txt',
  network_error: 'Network error, please try again',
  login_failed: 'Sign-in failed',
  err_login_required: 'Please sign in',
  err_csrf: 'This page has expired, please refresh',
  err_bad_credentials: 'Incorrect username or password',
  err_disabled: 'This account is disabled. Please contact the administrator',
  err_too_many_attempts: 'Too many attempts. Try again in 15 minutes',
  err_tier_required: 'Choose a plan',
  err_out_of_stock: 'No links available for this plan right now',
  err_nothing_selected: 'Select the links to return',
  orders_title: "My batches",
  no_orders: "No batch assigned yet. The administrator will assign one when needed",
  order_progress: "Paid {paid} / {qty} · pending {holding} · can claim {remaining}",
  order_replaced: "Replaced {used} / {limit}",
  order_done: "Completed",
  order_cancelled: "Cancelled",
  claim_n: "Claim {n}",
  col_batch: "Batch",
  replace: "Replace",
  replace_confirm: "Replace this link? It stops working and a new one is issued (does not use batch quota).",
  replaced_ok: "Replaced",
  replaced_wait: "Old link voided. The new one is being prepared; claim it from the batch shortly",
  waiting_stock: "Links are being prepared, please claim again in a moment",
  err_too_fast: "Too fast, please wait a few seconds",
  err_order_required: "Choose a batch first",
  err_order_not_found: "Batch not found",
  err_order_closed: "This batch has ended",
  err_order_full: "This batch is fully claimed",
  err_cannot_replace: "This link cannot be replaced",
  err_replace_limit: "No replacements left for this batch. Please contact the administrator",
  search: "Search links",
  export_fields: "Export fields"
}
I18N.uz = {
  title: "To'lov havolalari",
  login_hint: 'Havolalarni olish uchun tizimga kiring',
  username: 'Login',
  password: 'Parol',
  login: 'Kirish',
  logout: 'Chiqish',
  auto_refresh: 'Har 3 soniyada avtomatik yangilanadi',
  loading: 'Yuklanmoqda…',
  updated_at: 'Yangilandi: {time}',
  refresh_failed: 'Yangilab bo‘lmadi: {msg}',
  stat_available: 'Mavjud',
  stat_claimed: "To'lov kutilmoqda",
  stat_paid: "To'langan (jami)",
  stat_today: "Bugun to'langan",
  claim_title: 'Havola olish',
  count: 'Soni',
  claim: 'Olish',
  claim_rule: "Olingan havolalarni faqat siz ko'rasiz. {timeout} ichida to'lanmasa, ular qaytarib olinadi va yangi havolalar bilan almashtiriladi; eski havolalar ishlamaydi.",
  hours: '{n} soat',
  minutes: '{n} daqiqa',
  pending_title: "To'lov kutilmoqda",
  select_all: 'Hammasini tanlash',
  select_none: 'Tanlovni tozalash',
  copy_selected: 'Tanlanganlarni nusxalash',
  export_txt: 'Tanlanganlarni TXT ga eksport',
  release_selected: 'Tanlanganlarni qaytarish',
  selected_n: '{n} ta tanlandi',
  col_tier: 'Tarif / summa',
  col_link: "To'lov havolasi",
  col_left: 'Qolgan vaqt',
  col_paid_at: "To'langan vaqt",
  no_claimed: 'Hali havola olinmagan',
  paid_title: "To'langan",
  from: 'Dan',
  to: 'Gacha',
  export_csv: 'CSV hisobotni yuklab olish',
  no_paid: "Hali to'langan havola yo'q",
  available_n: '{n} ta mavjud',
  list_price: 'Asl narx ${n}/oy',
  no_stock: "Hozircha mavjud havola yo'q",
  refreshing_n: ' ({n} tasi yangi havolaga almashtirilmoqda)',
  checking: "To'lov tekshirilmoqda",
  left_hm: '{h} soat {m} daqiqa',
  left_m: '{m} daqiqa',
  pick_tier: 'Avval tarifni tanlang',
  claimed_ok: '{n} ta havola olindi va tanlandi, nusxalashga tayyor',
  claimed_short: ' (zaxira yetmadi, {n} ta kam)',
  pick_links: 'Avval havolalarni belgilang',
  copied: '{n} ta havola nusxalandi',
  release_confirm: '{n} ta havolani qaytarasizmi? Ular ishlamay qoladi va yangi havolalar bilan almashtiriladi.',
  released: '{n} ta havola qaytarildi',
  daily_item: '{day}: {n} ta',
  select_row: '{n}-qatorni tanlash',
  txt_header: "# To'lov havolalari — jami {n} ta — eksport: {time}\n# Har qatorda bitta havola, raqamlangan; tartib bilan ochib to'lang.",
  txt_file: 'tolov-havolalari_{n}_{time}.txt',
  network_error: 'Tarmoq xatosi, qayta urinib ko‘ring',
  login_failed: 'Kirib bo‘lmadi',
  err_login_required: 'Iltimos, tizimga kiring',
  err_csrf: 'Sahifa eskirgan, yangilang',
  err_bad_credentials: "Login yoki parol noto'g'ri",
  err_disabled: "Hisob o'chirilgan. Administratorga murojaat qiling",
  err_too_many_attempts: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring",
  err_tier_required: 'Tarifni tanlang',
  err_out_of_stock: "Bu tarif uchun hozircha havola yo'q",
  err_nothing_selected: 'Qaytariladigan havolalarni tanlang',
  orders_title: "Mening partiyalarim",
  no_orders: "Sizga hali partiya berilmagan. Kerak bo'lganda administrator beradi",
  order_progress: "To'langan {paid} / {qty} · kutilmoqda {holding} · olish mumkin {remaining}",
  order_replaced: "Almashtirildi {used} / {limit}",
  order_done: "Bajarildi",
  order_cancelled: "Bekor qilindi",
  claim_n: "{n} ta olish",
  col_batch: "Partiya",
  replace: "Almashtirish",
  replace_confirm: "Bu havolani almashtirasizmi? U ishlamay qoladi va yangisi beriladi (partiya limitidan olinmaydi).",
  replaced_ok: "Almashtirildi",
  replaced_wait: "Eski havola bekor qilindi. Yangisi tayyorlanmoqda, birozdan keyin partiyadan oling",
  waiting_stock: "Havolalar tayyorlanmoqda, birozdan keyin qayta oling",
  err_too_fast: "Juda tez, bir necha soniya kuting",
  err_order_required: "Avval partiyani tanlang",
  err_order_not_found: "Partiya topilmadi",
  err_order_closed: "Bu partiya tugagan",
  err_order_full: "Bu partiya to'liq olingan",
  err_cannot_replace: "Bu havolani almashtirib bo'lmaydi",
  err_replace_limit: "Bu partiya uchun almashtirish qolmadi. Administratorga murojaat qiling",
  search: "Havolani qidirish",
  export_fields: "Eksport maydonlari"
}

const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'uz', label: "O'zbekcha" }
]

/** 当前语言：上次选的 → 浏览器语言 → 中文 */
function detectLang() {
  const saved = localStorage.getItem('pl.lang')
  if (saved && I18N[saved]) return saved
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('uz')) return 'uz'
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

let LANG = detectLang()

function t(key, params) {
  let text = (I18N[LANG] && I18N[LANG][key]) ?? I18N.zh[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v))
  return text
}

/** 服务器报错：有错误码就按当前语言翻译，没有就用原文 */
function tError(data, fallbackKey) {
  if (data && data.code && I18N.zh[`err_${data.code}`]) return t(`err_${data.code}`)
  return (data && data.error) || t(fallbackKey)
}

function applyI18n() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : LANG
  document.title = t('title')
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh)
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel))
  const select = document.getElementById('lang')
  if (select) select.value = LANG
}

/** 语言下拉：换了就重新套文案，并通知页面脚本重渲染动态内容 */
function mountLangSwitch() {
  const select = document.getElementById('lang')
  if (!select) return
  select.innerHTML = LANGS.map((l) => `<option value="${l.code}">${l.label}</option>`).join('')
  select.value = LANG
  select.addEventListener('change', () => {
    LANG = select.value
    localStorage.setItem('pl.lang', LANG)
    applyI18n()
    document.dispatchEvent(new CustomEvent('langchange'))
  })
  applyI18n()
}

document.addEventListener('DOMContentLoaded', mountLangSwitch)
