<?php
// 管理后台（网页版）：手机上也能派单、管客户、查链接。功能与桌面端「网站管理」一致，接口同一套
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
$authed = admin_session_ok();
$csrf = $authed ? ($_SESSION['admin_csrf'] ?? '') : '';
$v = '5';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>管理后台</title>
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/manage.css?v=<?= $v ?>">
</head>
<body>
<?php if (!$authed): ?>
<main class="login-wrap">
  <form id="login" class="card login-card">
    <h1>管理后台</h1>
    <label>账号<input name="username" autocomplete="username" required></label>
    <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary">登录</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<script>
document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const f = e.currentTarget
  const res = await fetch('api.php?action=admin_login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value })
  })
  const data = await res.json().catch(() => ({}))
  if (data.ok) location.reload()
  else document.getElementById('login-error').textContent = data.error || '登录失败'
})
</script>
<?php else: ?>
<main class="app" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
  <header class="card head">
    <h1>管理后台</h1>
    <nav class="tabs" role="tablist">
      <button class="tab active" data-tab="overview">总览</button>
      <button class="tab" data-tab="orders">派单</button>
      <button class="tab" data-tab="clients">客户</button>
      <button class="tab" data-tab="links">链接</button>
      <button class="tab" data-tab="logs">日志</button>
    </nav>
    <button id="logout" class="btn ghost">退出</button>
  </header>
  <section id="tab-overview" class="panel"></section>
  <section id="tab-orders" class="panel" hidden></section>
  <section id="tab-clients" class="panel" hidden></section>
  <section id="tab-links" class="panel" hidden></section>
  <section id="tab-logs" class="panel" hidden></section>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>
<script src="assets/manage.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
