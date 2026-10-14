<?php
// 客户门户：概览 / 我的批次 / 待付款 / 已付款 / 结算记录 / 收款设置。数据都走 api.php 的分页接口
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header('Referrer-Policy: same-origin');
$authed = logged_in();
$csrf = $authed ? csrf_token() : '';
$v = '14';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Payment links</title>
<link rel="stylesheet" href="assets/ui.css?v=<?= $v ?>">
<script src="assets/i18n.js?v=<?= $v ?>"></script>
</head>
<body>
<?php if (!$authed): ?>
<main class="auth">
  <form id="login" class="card auth-card" autocomplete="on">
    <div class="brand"><div class="brand-mark">P</div><div><b data-i18n="title">支付链接</b><span data-i18n="portal_sub">客户门户</span></div></div>
    <p class="text-2" style="margin:0" data-i18n="login_hint">请登录后领取链接</p>
    <label class="field"><span data-i18n="username">账号</span><input name="username" autocomplete="username" required></label>
    <label class="field"><span data-i18n="password">密码</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary block" data-i18n="login">登录</button>
    <p id="login-error" class="error" role="alert"></p>
    <div class="auth-foot"><span class="muted small">© Payment links</span><select id="lang" aria-label="Language" style="width:auto"></select></div>
  </form>
</main>
<script src="assets/login.js?v=<?= $v ?>"></script>
<?php else: ?>
<div class="shell" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark">P</div><div><b data-i18n="title">支付链接</b><span data-i18n="portal_sub">客户门户</span></div>
      <button class="btn ghost close-btn sidebar-close" data-i18n-label="close_menu" aria-label="关闭菜单">✕</button></div>
    <nav class="nav" aria-label="Main">
      <button class="nav-item" data-view="work"><span class="nav-ico">⚡</span><span data-i18n="nav_work">付款工作台</span><span class="count" id="nav-pending"></span></button>
      <button class="nav-item" data-view="orders"><span class="nav-ico">▤</span><span data-i18n="nav_orders">我的批次</span><span class="count" id="nav-orders"></span></button>
      <button class="nav-item" data-view="paid"><span class="nav-ico">✓</span><span data-i18n="nav_paid">已付款</span></button>
      <button class="nav-item" data-view="settlements"><span class="nav-ico">⇄</span><span data-i18n="nav_settlements">结算记录</span></button>
      <button class="nav-item" data-view="wallet"><span class="nav-ico">◎</span><span data-i18n="nav_wallet">收款设置</span></button>
    </nav>
    <div class="sidebar-foot">
      <div class="user-chip"><div class="avatar" id="avatar">-</div><div style="min-width:0"><b id="who" class="nowrap"></b><div class="muted small" id="updated"></div></div></div>
      <div class="btn-group"><select id="lang" aria-label="Language" style="width:auto;height:30px"></select><button id="logout" class="btn sm" data-i18n="logout">退出登录</button></div>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <button class="btn ghost menu-btn" data-i18n-label="open_menu" aria-label="Menu">☰</button>
      <h1 id="page-title"></h1>
      <span class="muted small" data-i18n="auto_refresh_s">自动刷新</span>
    </header>
    <main class="content">
      <section data-section="work" hidden></section>
      <section data-section="orders" hidden></section>
      <section data-section="paid" hidden></section>
      <section data-section="settlements" hidden></section>
      <section data-section="wallet" hidden></section>
    </main>
  </div>
</div>
<script src="assets/ui.js?v=<?= $v ?>"></script>
<script src="assets/portal.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
