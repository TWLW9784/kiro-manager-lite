<?php
// 客户侧接口：登录、页面状态、领取、放回、导出已付款
declare(strict_types=1);

function action_login(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    $ip = client_ip();
    $pdo = db();
    $recent = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > DATE_SUB(?, INTERVAL 15 MINUTE)');
    $recent->execute([$ip, now()]);
    if ((int) $recent->fetchColumn() >= 8) fail('尝试次数过多，请 15 分钟后再试', 429);

    $in = body();
    $client = config()['client'];
    $okUser = hash_equals((string) $client['username'], (string) ($in['username'] ?? ''));
    $okPass = password_verify((string) ($in['password'] ?? ''), (string) $client['password_hash']);
    if (!$okUser || !$okPass) {
        $pdo->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
        fail('账号或密码不正确', 401);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['user'] = $client['username'];
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    json_out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
}

function action_logout(): never
{
    start_session();
    $_SESSION = [];
    session_destroy();
    json_out(['ok' => true]);
}

/** 页面每隔几秒拉一次的全部数据 */
function action_state(): never
{
    require_login();
    release_timeouts();
    $pdo = db();
    $timeout = (int) (config()['claim_timeout_minutes'] ?? 180);

    // 可领取：按档位汇总，不下发链接本身，领了才给
    $tiers = $pdo->query(
        "SELECT tier, COUNT(*) AS n, MIN(amount_due) AS min_usd, MAX(amount_due) AS max_usd,
                MIN(amount_cny) AS min_cny, MAX(amount_cny) AS max_cny, MIN(list_price) AS list_price
         FROM links WHERE status = 'available' GROUP BY tier ORDER BY MIN(list_price), tier"
    )->fetchAll();

    $claimed = $pdo->query(
        "SELECT id, url, tier, amount_due, amount_cny, status, claimed_at, claim_batch
         FROM links WHERE status IN ('claimed', 'checking') ORDER BY claimed_at DESC, id"
    )->fetchAll();
    foreach ($claimed as &$row) {
        $deadline = strtotime((string) $row['claimed_at']) + $timeout * 60;
        $row['expires_in'] = max(0, $deadline - time());
    }
    unset($row);

    $paid = $pdo->query(
        "SELECT id, url, tier, amount_due, amount_cny, paid_at FROM links
         WHERE status = 'paid' ORDER BY paid_at DESC, id DESC LIMIT 300"
    )->fetchAll();

    // 结算：已付款数量，今天 / 按天 / 累计
    $daily = $pdo->query(
        "SELECT DATE(paid_at) AS day, COUNT(*) AS n, SUM(amount_due) AS usd, SUM(amount_cny) AS cny
         FROM links WHERE status = 'paid' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(paid_at) ORDER BY day DESC"
    )->fetchAll();
    $total = $pdo->query("SELECT COUNT(*) FROM links WHERE status = 'paid'")->fetchColumn();
    $refreshing = $pdo->query("SELECT COUNT(*) FROM links WHERE status = 'refresh'")->fetchColumn();

    json_out([
        'ok' => true,
        'now' => now(),
        'timeout_minutes' => $timeout,
        'max_claim' => (int) (config()['max_claim'] ?? 50),
        'tiers' => $tiers,
        'claimed' => $claimed,
        'paid' => $paid,
        'paid_total' => (int) $total,
        'daily' => $daily,
        'refreshing' => (int) $refreshing,
    ]);
}

/** 领取：按档位取 N 条，最便宜的先给；行锁防止两个页面同时领到同一条 */
function action_claim(): never
{
    require_login();
    $in = body();
    $tier = (string) ($in['tier'] ?? '');
    $max = (int) (config()['max_claim'] ?? 50);
    $count = max(1, min($max, (int) ($in['count'] ?? 0)));
    if ($tier === '') fail('请选择档位');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pick = $pdo->prepare(
            "SELECT id FROM links WHERE status = 'available' AND tier = ?
             ORDER BY amount_due IS NULL, amount_due, extracted_at LIMIT $count FOR UPDATE"
        );
        $pick->execute([$tier]);
        $ids = array_map('intval', $pick->fetchAll(PDO::FETCH_COLUMN));
        if (!$ids) {
            $pdo->rollBack();
            fail('这个档位暂时没有可领取的链接');
        }
        $batch = date('mdHis') . '-' . bin2hex(random_bytes(2));
        $in_ids = implode(',', $ids);
        $t = now();
        $pdo->prepare(
            "UPDATE links SET status = 'claimed', claimed_at = ?, claim_batch = ?, updated_at = ? WHERE id IN ($in_ids)"
        )->execute([$t, $batch, $t]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $rows = $pdo->query("SELECT id, url, tier, amount_due, amount_cny FROM links WHERE id IN ($in_ids) ORDER BY amount_due, id")->fetchAll();
    json_out(['ok' => true, 'batch' => $batch, 'links' => $rows, 'short' => $count - count($rows)]);
}

/**
 * 放回：客户确定不付了。不直接回到可领取，而是等桌面端换一条新链接：
 * 旧链接已经发出去过，回到池子里可能被第二个人领到，两人付同一条 */
function action_release(): never
{
    require_login();
    $ids = array_values(array_filter(array_map('intval', (array) (body()['ids'] ?? []))));
    if (!$ids) fail('请选择要放回的链接');
    $in_ids = implode(',', $ids);
    $t = now();
    $stmt = db()->prepare(
        "UPDATE links SET status = 'refresh', refresh_reason = 'released', updated_at = ?
         WHERE id IN ($in_ids) AND status = 'claimed'"
    );
    $stmt->execute([$t]);
    json_out(['ok' => true, 'released' => $stmt->rowCount()]);
}

/** 导出已付款（结算对账）：CSV，可按日期范围 */
function action_export_paid(): never
{
    require_login();
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? $_GET['from'] : '2000-01-01';
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? $_GET['to'] : '2999-12-31';
    $stmt = db()->prepare(
        "SELECT paid_at, tier, amount_due, amount_cny, url FROM links
         WHERE status = 'paid' AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY paid_at"
    );
    $stmt->execute([$from, $to]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="paid-' . $from . '_' . $to . '.csv"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // BOM：Excel 直接打开不乱码
    fputcsv($out, ['序号', '付款时间', '档位', '实付(USD)', '实付(CNY)', '支付链接']);
    $i = 0;
    while ($row = $stmt->fetch()) {
        fputcsv($out, [++$i, $row['paid_at'], $row['tier'], $row['amount_due'], $row['amount_cny'], $row['url']]);
    }
    fclose($out);
    exit;
}
