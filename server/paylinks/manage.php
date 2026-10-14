<?php
// 管理后台：未登录显示登录卡，登录后挂载 Vue 应用（assets/app/admin.js）
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
page_headers();
$authed = admin_session_ok();
$csrf = $authed ? ($_SESSION['admin_csrf'] ?? '') : '';
$admin = (string) ($_SESSION['admin'] ?? 'admin');
$v = '24';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>管理后台 · Payment links</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%236366f1'/><text x='16' y='23' font-family='system-ui,sans-serif' font-size='20' font-weight='700' fill='%23fff' text-anchor='middle'>P</text></svg>">
<?php if ($authed): ?>
<link rel="stylesheet" href="assets/app/vendor.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/app/admin.css?v=<?= $v ?>">
<?php else: ?>
<link rel="stylesheet" href="assets/ui.css?v=<?= $v ?>">
<?php endif; ?>
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
<script src="assets/admin-login.js?v=<?= $v ?>"></script>
<?php else: ?>
<div
  id="app"
  data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>"
  data-admin="<?= htmlspecialchars($admin, ENT_QUOTES) ?>"
></div>
<script type="module" src="assets/app/admin.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>
