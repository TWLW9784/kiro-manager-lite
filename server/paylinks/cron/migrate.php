<?php
// 数据库升级：只增不删，可重复执行。部署后跑一次：php cron/migrate.php
//
// v2：客户账号从 config.php 挪进 clients 表，支持多个客户；links 加 client_id，
//     每个客户只看到自己领的、只结算自己的。config.php 里原来那个账号自动迁成第一个客户，
//     它名下已领 / 已付的链接一起归过去。
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../inc/lib.php';

$pdo = db();

function has_column(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([$table, $column]);
    return (bool) $stmt->fetchColumn();
}

$pdo->exec(
    "CREATE TABLE IF NOT EXISTS clients (
       id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       username        VARCHAR(64)  NOT NULL,
       password_hash   VARCHAR(255) NOT NULL,
       display_name    VARCHAR(64)  NOT NULL DEFAULT '',
       enabled         TINYINT(1)   NOT NULL DEFAULT 1,
       max_claim       INT UNSIGNED NOT NULL DEFAULT 50,
       claim_timeout_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
       session_version INT UNSIGNED NOT NULL DEFAULT 1,
       note            VARCHAR(255) NOT NULL DEFAULT '',
       last_login_at   DATETIME     NULL,
       created_at      DATETIME     NOT NULL,
       updated_at      DATETIME     NOT NULL,
       UNIQUE KEY uk_username (username)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);

if (!has_column($pdo, 'links', 'client_id')) {
    $pdo->exec('ALTER TABLE links ADD COLUMN client_id INT UNSIGNED NULL AFTER status, ADD KEY idx_client (client_id, status)');
    echo "links.client_id added\n";
}

// 第一个客户：来自 config.php 的旧单账号
$legacy = config()['client'] ?? null;
$count = (int) $pdo->query('SELECT COUNT(*) FROM clients')->fetchColumn();
if ($count === 0 && $legacy && !empty($legacy['username']) && !empty($legacy['password_hash'])) {
    $t = now();
    $pdo->prepare(
        'INSERT INTO clients (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )->execute([$legacy['username'], $legacy['password_hash'], $legacy['username'], $t, $t]);
    $id = (int) $pdo->lastInsertId();
    $moved = $pdo->exec("UPDATE links SET client_id = $id WHERE client_id IS NULL AND status IN ('claimed', 'checking', 'paid')");
    echo "migrated legacy client '{$legacy['username']}' as #$id, $moved links assigned\n";
}

// v3：订单批次。管理员给客户派单（档位 × 数量），客户只能在自己的批次里领；
//     更换链接不占额度但有次数上限；付款数达到订单数批次自动完成。
$pdo->exec(
    "CREATE TABLE IF NOT EXISTS orders (
       id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       code          VARCHAR(32)  NOT NULL,
       client_id     INT UNSIGNED NOT NULL,
       tier          VARCHAR(16)  NOT NULL,
       quantity      INT UNSIGNED NOT NULL,
       replace_limit INT UNSIGNED NOT NULL DEFAULT 0,
       replaced      INT UNSIGNED NOT NULL DEFAULT 0,
       status        VARCHAR(16)  NOT NULL DEFAULT 'open',
       note          VARCHAR(255) NOT NULL DEFAULT '',
       created_at    DATETIME     NOT NULL,
       done_at       DATETIME     NULL,
       updated_at    DATETIME     NOT NULL,
       UNIQUE KEY uk_code (code),
       KEY idx_client_status (client_id, status)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
);
if (!has_column($pdo, 'links', 'order_id')) {
    $pdo->exec('ALTER TABLE links ADD COLUMN order_id INT UNSIGNED NULL AFTER client_id, ADD KEY idx_order (order_id, status)');
    echo "links.order_id added\n";
}
if (!has_column($pdo, 'clients', 'last_action_at')) {
    // 领取 / 更换限速用：同一客户 3 秒内只能操作一次
    $pdo->exec('ALTER TABLE clients ADD COLUMN last_action_at DATETIME(3) NULL');
    echo "clients.last_action_at added\n";
}

// 历史批次：已经归属客户、但还没有批次的链接（v2 之前领的），每个客户归成一个批次
$orphans = $pdo->query(
    "SELECT client_id, tier, COUNT(*) AS n, SUM(status = 'paid') AS paid, MIN(claimed_at) AS first_at
     FROM links WHERE client_id IS NOT NULL AND order_id IS NULL AND status IN ('claimed', 'checking', 'paid')
     GROUP BY client_id, tier"
)->fetchAll();
foreach ($orphans as $o) {
    $t = now();
    $code = 'H' . date('ymd') . '-' . $o['client_id'] . '-' . preg_replace('/[^a-z0-9]/i', '', $o['tier']);
    $done = (int) $o['paid'] >= (int) $o['n'];
    $pdo->prepare(
        "INSERT IGNORE INTO orders (code, client_id, tier, quantity, replace_limit, status, note, created_at, done_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '历史批次（派单功能上线前领取的）', ?, ?, ?)"
    )->execute([$code, $o['client_id'], $o['tier'], $o['n'], $o['n'], $done ? 'done' : 'open', $o['first_at'] ?: $t, $done ? $t : null, $t]);
    $id = (int) $pdo->query('SELECT id FROM orders WHERE code = ' . $pdo->quote($code))->fetchColumn();
    $moved = $pdo->prepare(
        "UPDATE links SET order_id = ? WHERE client_id = ? AND tier = ? AND order_id IS NULL AND status IN ('claimed', 'checking', 'paid')"
    );
    $moved->execute([$id, $o['client_id'], $o['tier']]);
    echo "history order $code: {$moved->rowCount()} links\n";
}

// 领取超时的列默认值：老库建表时是 180 分钟，策略已改成 24 小时。
// 只改默认值，不动已有客户各自设定的值。
$def = $pdo->query(
    "SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'claim_timeout_minutes'"
)->fetchColumn();
if ((int) $def !== 1440) {
    $pdo->exec('ALTER TABLE clients MODIFY claim_timeout_minutes INT UNSIGNED NOT NULL DEFAULT 1440');
    echo "clients.claim_timeout_minutes default {$def} -> 1440\n";
}

echo "migrate ok\n";
