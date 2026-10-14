<?php
// 管理后台（网页）：总览 / 批次（含结算）/ 结算记录 / 客户 / 链接 / 日志。接口与桌面端「网站管理」同一套
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
$authed = admin_session_ok();
$csrf = $authed ? ($_SESSION['admin_csrf'] ?? '') : '';
$v = '15';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>管理后台 · Payment links</title>
<link rel="stylesheet" href="assets/ui.css?v=<?= $v ?>">
</head>
<body>
<?php if (!$authed): ?>
<main class="auth">
  <form id="login" class="card auth-card">
    <div class="brand"><div class="brand-mark">P</div><div><b>管理后台</b><span>Payment links</span></div></div>
    <label class="field"><span>账号</span><input name="username" autocomplete="username" required></label>
    <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary block">登录</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<script>
document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = e.currentTarget
  const btn = f.querySelector('button')
  btn.disabled = true
  try {
    const res = await fetch('api.php?action=admin_login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value })
    })
    const data = await res.json().catch(() => ({}))
    if (data.ok) location.reload()
    else document.getElementById('login-error').textContent = data.error || '登录失败'
  } finally {
    btn.disabled = false
  }
})
</script>
<?php else: ?>
<div class="shell" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark">P</div><div><b>管理后台</b><span>Payment links</span></div><button class="btn ghost close-btn sidebar-close" aria-label="关闭菜单">✕</button></div>
    <nav class="nav" aria-label="主导航">
      <button class="nav-item" data-view="overview"><span class="nav-ico">◧</span>总览</button>
      <button class="nav-item" data-view="orders"><span class="nav-ico">▤</span>批次<span class="count" id="nav-orders"></span></button>
      <button class="nav-item" data-view="settlements"><span class="nav-ico">⇄</span>结算<span class="count" id="nav-unsettled"></span></button>
      <button class="nav-item" data-view="clients"><span class="nav-ico">◎</span>客户</button>
      <button class="nav-item" data-view="links"><span class="nav-ico">⛓</span>链接</button>
      <button class="nav-item" data-view="logs"><span class="nav-ico">≡</span>日志</button>
    </nav>
    <div class="sidebar-foot">
      <div class="user-chip"><div class="avatar">A</div><div style="min-width:0"><b><?= htmlspecialchars((string) ($_SESSION['admin'] ?? 'admin'), ENT_QUOTES) ?></b><div class="muted small" id="desktop-state">-</div></div></div>
      <button id="logout" class="btn sm">退出登录</button>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="btn ghost menu-btn" aria-label="菜单">☰</button>
      <h1 id="page-title"></h1>
      <div class="btn-group" id="top-actions"></div>
    </header>
    <main class="content">
      <section data-section="overview" hidden></section>
      <section data-section="orders" hidden></section>
      <section data-section="settlements" hidden></section>
      <section data-section="clients" hidden></section>
      <section data-section="links" hidden></section>
      <section data-section="logs" hidden></section>
    </main>
  </div>
</div>
<script src="assets/ui.js?v=<?= $v ?>"></script>
<script src="assets/admin.js?v=<?= $v ?>"></script>
<script src="assets/admin-more.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
