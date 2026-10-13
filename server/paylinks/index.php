<?php
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
$authed = logged_in();
$csrf = $authed ? csrf_token() : '';
$v = '3';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Payment links</title>
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
<script src="assets/i18n.js?v=<?= $v ?>"></script>
</head>
<body>
<?php if (!$authed): ?>
<main class="login-wrap">
  <form id="login" class="card login-card" autocomplete="on">
    <div class="login-head">
      <h1 data-i18n="title">支付链接</h1>
      <select id="lang" class="lang" aria-label="Language"></select>
    </div>
    <p class="muted" data-i18n="login_hint">请登录后领取链接</p>
    <label><span data-i18n="username">账号</span><input name="username" autocomplete="username" required></label>
    <label><span data-i18n="password">密码</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary" data-i18n="login">登录</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<script src="assets/login.js?v=<?= $v ?>"></script>
<?php else: ?>
<main class="app" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
  <header class="card head">
    <div>
      <h1 data-i18n="title">支付链接</h1>
      <p class="muted small"><span id="who"></span> · <span data-i18n="auto_refresh">每 3 秒自动刷新</span> · <span id="updated"></span></p>
    </div>
    <div class="stats">
      <div class="stat"><b id="stat-available">-</b><span data-i18n="stat_available">可领取</span></div>
      <div class="stat warn"><b id="stat-claimed">-</b><span data-i18n="stat_claimed">待付款</span></div>
      <div class="stat ok"><b id="stat-paid">-</b><span data-i18n="stat_paid">已付款（累计）</span></div>
      <div class="stat ok"><b id="stat-today">-</b><span data-i18n="stat_today">今日已付</span></div>
    </div>
    <select id="lang" class="lang" aria-label="Language"></select>
    <button id="logout" class="btn ghost" data-i18n="logout">退出登录</button>
  </header>

  <!-- 我的批次：管理员派单后才有；只能在批次额度内领，链接异常可以更换 -->
  <section class="card claim">
    <h2 data-i18n="orders_title">我的批次</h2>
    <div id="orders" class="orders"></div>
    <p id="claim-msg" class="muted small" role="status"></p>
    <p id="claim-rule" class="muted small"></p>
  </section>

  <div class="columns">
    <section class="card col">
      <div class="col-head">
        <h2><span data-i18n="pending_title">待付款</span> <span id="claimed-count" class="badge warn">0</span></h2>
        <div class="actions" id="pending-actions">
          <button class="btn" data-act="select-all" data-i18n="select_all">全选</button>
          <button class="btn" data-act="select-none" data-i18n="select_none">清空选择</button>
          <button class="btn primary" data-act="copy" data-i18n="copy_selected">复制所选</button>
          <button class="btn" data-act="txt" data-i18n="export_txt">导出所选 TXT</button>
          <button class="btn danger" data-act="release" data-i18n="release_selected">放回所选</button>
          <span id="selected" class="muted small"></span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="c-check"><input type="checkbox" id="check-all" data-i18n-label="select_all"></th>
            <th class="c-n">#</th>
            <th class="c-batch" data-i18n="col_batch">批次</th>
            <th class="c-tier" data-i18n="col_tier">档位 / 金额</th>
            <th data-i18n="col_link">支付链接</th>
            <th class="c-time" data-i18n="col_left">剩余时间</th>
            <th class="c-act"></th>
          </tr></thead>
          <tbody id="claimed"></tbody>
        </table>
        <p id="claimed-empty" class="empty" data-i18n="no_claimed">还没有领取链接</p>
      </div>
    </section>

    <section class="card col paid-col">
      <div class="col-head">
        <h2><span data-i18n="paid_title">已付款</span> <span id="paid-count" class="badge ok">0</span></h2>
        <div class="actions">
          <label class="small"><span data-i18n="from">从</span><input id="from" type="date"></label>
          <label class="small"><span data-i18n="to">到</span><input id="to" type="date"></label>
          <button class="btn" id="export-paid" data-i18n="export_csv">导出对账 CSV</button>
        </div>
      </div>
      <div id="daily" class="daily"></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="c-n">#</th>
            <th class="c-batch" data-i18n="col_batch">批次</th>
            <th class="c-tier" data-i18n="col_tier">档位 / 金额</th>
            <th data-i18n="col_link">支付链接</th>
            <th class="c-time" data-i18n="col_paid_at">付款时间</th>
          </tr></thead>
          <tbody id="paid"></tbody>
        </table>
        <p id="paid-empty" class="empty" data-i18n="no_paid">还没有已付款的链接</p>
      </div>
    </section>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>
<script src="assets/app.js?v=<?= $v ?>"></script>
<?php endif; ?>
</body>
</html>