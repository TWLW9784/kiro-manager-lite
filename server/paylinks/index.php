<?php
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
$authed = logged_in();
$csrf = $authed ? csrf_token() : '';
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>支付链接</title>
<link rel="stylesheet" href="assets/app.css?v=1">
</head>
<body>
<?php if (!$authed): ?>
<main class="login-wrap">
  <form id="login" class="card login-card" autocomplete="on">
    <h1>支付链接</h1>
    <p class="muted">请登录后领取链接</p>
    <label>账号<input name="username" autocomplete="username" required></label>
    <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit" class="btn primary">登录</button>
    <p id="login-error" class="error" role="alert"></p>
  </form>
</main>
<script src="assets/login.js?v=1"></script>
<?php else: ?>
<main class="app" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
  <header class="card head">
    <div>
      <h1>支付链接</h1>
      <p class="muted small">每 3 秒自动刷新 · <span id="updated">加载中…</span></p>
    </div>
    <div class="stats">
      <div class="stat"><b id="stat-available">-</b><span>可领取</span></div>
      <div class="stat warn"><b id="stat-claimed">-</b><span>待付款</span></div>
      <div class="stat ok"><b id="stat-paid">-</b><span>已付款（累计）</span></div>
      <div class="stat ok"><b id="stat-today">-</b><span>今日已付</span></div>
    </div>
    <button id="logout" class="btn ghost">退出登录</button>
  </header>

  <section class="card claim">
    <h2>领取链接</h2>
    <div id="tiers" class="tiers" role="radiogroup" aria-label="档位"></div>
    <div class="claim-row">
      <label>数量<input id="count" type="number" min="1" max="50" value="10"></label>
      <button id="claim" class="btn primary">领取</button>
      <span id="claim-msg" class="muted small" role="status"></span>
    </div>
    <p class="muted small">领走的链接只有你看得到；<span id="timeout-text">3 小时</span>内没付款会自动收回并换成新链接，旧链接作废。</p>
  </section>

  <div class="columns">
    <section class="card col">
      <div class="col-head">
        <h2>待付款 <span id="claimed-count" class="badge warn">0</span></h2>
        <div class="actions">
          <button class="btn" data-act="select-all">全选</button>
          <button class="btn" data-act="select-none">清空选择</button>
          <button class="btn primary" data-act="copy">复制所选</button>
          <button class="btn" data-act="txt">导出所选 TXT</button>
          <button class="btn danger" data-act="release">放回所选</button>
          <span id="selected" class="muted small">已选 0</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="c-check"><input type="checkbox" id="check-all" aria-label="全选"></th><th class="c-n">#</th><th class="c-tier">档位 / 金额</th><th>支付链接</th><th class="c-time">剩余时间</th></tr></thead>
          <tbody id="claimed"></tbody>
        </table>
        <p id="claimed-empty" class="empty">还没有领取链接</p>
      </div>
    </section>

    <section class="card col paid-col">
      <div class="col-head">
        <h2>已付款 <span id="paid-count" class="badge ok">0</span></h2>
        <div class="actions">
          <label class="small">从<input id="from" type="date"></label>
          <label class="small">到<input id="to" type="date"></label>
          <button class="btn" id="export-paid">导出对账 CSV</button>
        </div>
      </div>
      <div id="daily" class="daily"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="c-n">#</th><th class="c-tier">档位 / 金额</th><th>支付链接</th><th class="c-time">付款时间</th></tr></thead>
          <tbody id="paid"></tbody>
        </table>
        <p id="paid-empty" class="empty">还没有已付款的链接</p>
      </div>
    </section>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</main>
<script src="assets/app.js?v=1"></script>
<?php endif; ?>
</body>
</html>