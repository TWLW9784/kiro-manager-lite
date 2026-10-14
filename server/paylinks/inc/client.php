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
    if ((int) $recent->fetchColumn() >= 8) fail('尝试次数过多，请 15 分钟后再试', 429, 'too_many_attempts');

    $in = body();
    $find = $pdo->prepare('SELECT * FROM clients WHERE username = ?');
    $find->execute([trim((string) ($in['username'] ?? ''))]);
    $client = $find->fetch() ?: null;
    // 账号不存在也跑一次 password_verify，响应时间不暴露「账号存在与否」
    $hash = $client['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuJ8o4j1Qy0TfU1Z1j3eYQ0lY3xHn1x2S';
    $okPass = password_verify((string) ($in['password'] ?? ''), $hash);
    if (!$client || !$okPass) {
        $pdo->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
        fail('账号或密码不正确', 401, 'bad_credentials');
    }
    if (!$client['enabled']) fail('账号已停用，请联系管理员', 403, 'disabled');
    start_session();
    session_regenerate_id(true);
    $_SESSION['client_id'] = (int) $client['id'];
    $_SESSION['session_version'] = (int) $client['session_version'];
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
    $pdo->prepare('UPDATE clients SET last_login_at = ? WHERE id = ?')->execute([now(), $client['id']]);
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
    $client = require_login();
    release_timeouts();
    $pdo = db();
    $cid = (int) $client['id'];
    $timeout = (int) $client['claim_timeout_minutes'];

    // 可领取：所有客户共用一个池子，按档位汇总，不下发链接本身，领了才给
    $tiers = $pdo->query(
        "SELECT tier, COUNT(*) AS n, MIN(amount_due) AS min_usd, MAX(amount_due) AS max_usd,
                MIN(amount_cny) AS min_cny, MAX(amount_cny) AS max_cny, MIN(list_price) AS list_price
         FROM links WHERE status = 'available' GROUP BY tier ORDER BY MIN(list_price), tier"
    )->fetchAll();

    // 已领 / 已付 / 结算：只看自己的
    $claimed = $pdo->query(
        "SELECT id, url, tier, amount_due, amount_cny, status, claimed_at, claim_batch, order_id
         FROM links WHERE client_id = $cid AND status IN ('claimed', 'checking') ORDER BY claimed_at DESC, id"
    )->fetchAll();
    foreach ($claimed as &$row) {
        $deadline = strtotime((string) $row['claimed_at']) + $timeout * 60;
        $row['expires_in'] = max(0, $deadline - time());
    }
    unset($row);

    $paid = $pdo->query(
        "SELECT id, url, tier, amount_due, amount_cny, paid_at, claim_batch, order_id FROM links
         WHERE client_id = $cid AND status = 'paid' ORDER BY paid_at DESC, id DESC LIMIT 300"
    )->fetchAll();

    // 结算：已付款数量，今天 / 按天 / 累计
    $daily = $pdo->query(
        "SELECT DATE(paid_at) AS day, COUNT(*) AS n, SUM(amount_due) AS usd, SUM(amount_cny) AS cny
         FROM links WHERE client_id = $cid AND status = 'paid' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(paid_at) ORDER BY day DESC"
    )->fetchAll();
    $total = $pdo->query("SELECT COUNT(*) FROM links WHERE client_id = $cid AND status = 'paid'")->fetchColumn();

    // 批次：进行中的全部 + 最近结束的 20 个，带各自的进度
    $orders = $pdo->query(
        "SELECT o.id, o.code, o.tier, o.quantity, o.replace_limit, o.replaced, o.status, o.source, o.note, o.created_at, o.done_at,
                SUM(l.status = 'paid') AS paid, SUM(l.status IN ('claimed', 'checking')) AS holding,
                SUM(l.status IN ('superseded', 'refresh')) AS void
         FROM orders o LEFT JOIN links l ON l.order_id = o.id
         WHERE o.client_id = $cid AND (o.status = 'open' OR o.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY))
         GROUP BY o.id ORDER BY o.status = 'open' DESC, o.id DESC LIMIT 40"
    )->fetchAll();
    foreach ($orders as &$o) {
        $o['remaining'] = $o['source'] === 'offline' ? 0 : max(0, (int) $o['quantity'] - (int) $o['paid'] - (int) $o['holding']);
    }
    unset($o);
    $refreshing = $pdo->query("SELECT COUNT(*) FROM links WHERE status = 'refresh'")->fetchColumn();

    json_out([
        'ok' => true,
        'now' => now(),
        'client' => ['username' => $client['username'], 'display_name' => $client['display_name']],
        'timeout_minutes' => $timeout,
        'max_claim' => (int) $client['max_claim'],
        'tiers' => $tiers,
        'claimed' => $claimed,
        'paid' => $paid,
        'paid_total' => (int) $total,
        'orders' => $orders,
        'daily' => $daily,
        'refreshing' => (int) $refreshing,
    ]);
}

/**
 * 放回：客户确定不付了。不直接回到可领取，而是等桌面端换一条新链接：
 * 旧链接已经发出去过，回到池子里可能被第二个人领到，两人付同一条 */
function action_release(): never
{
    $client = require_login();
    $ids = array_values(array_filter(array_map('intval', (array) (body()['ids'] ?? []))));
    if (!$ids) fail('请选择要放回的链接', 400, 'nothing_selected');
    $in_ids = implode(',', $ids);
    $t = now();
    // 只能放回自己领的
    $stmt = db()->prepare(
        "UPDATE links SET status = 'refresh', refresh_reason = 'released', updated_at = ?
         WHERE id IN ($in_ids) AND status = 'claimed' AND client_id = ?"
    );
    $stmt->execute([$t, (int) $client['id']]);
    json_out(['ok' => true, 'released' => $stmt->rowCount()]);
}

/**
 * 批次明细：这个批次里的每一条（待付 / 确认中 / 已付 / 已作废），点批次时看。
 * 作废的（换过新链接、超时放回）不给链接本身，免得被误付。
 */
function action_order_links(): never
{
    $client = require_login();
    $orderId = (int) ($_GET['order_id'] ?? body()['order_id'] ?? 0);
    $pdo = db();
    $order = $pdo->prepare('SELECT id, code, tier, quantity, status, source FROM orders WHERE id = ? AND client_id = ?');
    $order->execute([$orderId, (int) $client['id']]);
    $o = $order->fetch();
    if (!$o) fail('批次不存在', 404, 'order_not_found');
    $stmt = $pdo->prepare(
        "SELECT id, IF(status IN ('superseded', 'refresh'), NULL, url) AS url, tier, amount_due, amount_cny,
                IF(status IN ('superseded', 'refresh'), 'void', status) AS status, claimed_at, paid_at
         FROM links WHERE order_id = ? AND client_id = ?
         ORDER BY FIELD(IF(status IN ('superseded', 'refresh'), 'void', status), 'claimed', 'checking', 'paid', 'void'), id"
    );
    $stmt->execute([$orderId, (int) $client['id']]);
    json_out(['ok' => true, 'order' => $o, 'links' => $stmt->fetchAll()]);
}

/** 导出已付款（结算对账）：CSV，可按日期范围 */
function action_export_paid(): never
{
    $client = require_login();
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? $_GET['from'] : '2000-01-01';
    $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? $_GET['to'] : '2999-12-31';
    $stmt = db()->prepare(
        "SELECT paid_at, tier, amount_due, amount_cny, url FROM links
         WHERE client_id = ? AND status = 'paid' AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY paid_at"
    );
    $stmt->execute([(int) $client['id'], $from, $to]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="paid-' . $from . '_' . $to . '.csv"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // BOM：Excel 直接打开不乱码
    $headers = [
        'zh' => ['序号', '付款时间', '档位', '实付(USD)', '实付(CNY)', '支付链接'],
        'en' => ['No.', 'Paid at', 'Plan', 'Paid (USD)', 'Paid (CNY)', 'Payment link'],
        'uz' => ['№', "To'langan vaqt", 'Tarif', "To'langan (USD)", "To'langan (CNY)", "To'lov havolasi"],
    ];
    fputcsv($out, $headers[(string) ($_GET['lang'] ?? '')] ?? $headers['zh']);
    $i = 0;
    while ($row = $stmt->fetch()) {
        fputcsv($out, [++$i, $row['paid_at'], $row['tier'], $row['amount_due'], $row['amount_cny'], $row['url']]);
    }
    fclose($out);
    exit;
}
