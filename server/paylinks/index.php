<?php
// 客户门户：未登录显示登录卡（沿用 i18n.js + login.js），登录后挂载 Vue 应用（assets/app/portal.js）
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
page_headers();
$authed = logged_in();
$csrf = $authed ? csrf_token() : '';
$v = '35';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Payment links</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%236366f1'/><text x='16' y='23' font-family='system-ui,sans-serif' font-size='20' font-weight='700' fill='%23fff' text-anchor='middle'>P</text></svg>">
<?php if ($authed): ?>
<link rel="stylesheet" href="assets/app/vendor.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/app/portal.css?v=<?= $v ?>">
<?php else: ?>
<link rel="stylesheet" href="assets/ui.css?v=<?= $v ?>">
<script src="assets/i18n.js?v=<?= $v ?>"></script>
<?php endif; ?>
</head>
<body>
<?php if (!$authed): ?>
<main class="auth">
  <form id="login" class="card auth-card" autocomplete="on">
    <div class="brand"><div class="brand-mark">P</div><div><b data-i18n="title">支付链接</b><span data-i18n="portal_sub">客户门户</span></div></div>
    <p class="text-2" style="margin:0" data-i18n="login_hint">请使用管理员给你的账号登录</p>
    <label class="field"><span data-i18n="username">账号</span><input name="username" autocomplete="username" required></label>
    <label class="field"><span data-i18n="password">密码</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary block" data-i18n="login">登录</button>
    <p id="login-error" class="error" role="alert"></p>
    <div class="auth-foot"><span class="muted small">© Payment links</span><select id="lang" aria-label="Language" style="width:auto"></select></div>
  </form>
</main>
<script src="assets/login.js?v=<?= $v ?>"></script>
<?php else: ?>
<div id="app" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>"></div>
<script type="module" src="assets/app/portal.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
