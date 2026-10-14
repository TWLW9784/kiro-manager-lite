<?php
// 客户门户接口（分页版）：概览、我的批次、待付款、已付款、结算记录、收款地址、凭证
//   me            概览：账号、收款地址、统计（待付 / 已付 / 应结 / 已结 / 未结）
//   my_orders     我的批次（分页，可按状态 / 结算状态筛）
//   my_order      一个批次的详情：进度、全部链接（作废的不给链接）、结算记录
//   my_claimed    待付款链接（分页）
//   my_paid       已付款链接（分页，可按日期）
//   my_settlements 结算记录（分页）
//   wallet_save   改收款地址（要输当前密码）
//   proof         看自己的付款凭证
declare(strict_types=1);

function action_me(): never
{
    $client = require_login();
    release_timeouts();
    $pdo = db();
    $cid = (int) $client['id'];
    $s = $pdo->query(
        "SELECT SUM(status = 'claimed') AS claimed, SUM(status = 'checking') AS checking,
                SUM(status = 'paid') AS paid, SUM(status = 'paid' AND paid_at >= CURDATE()) AS paid_today,
                SUM(IF(status = 'paid', amount_due, 0)) AS paid_usd, SUM(IF(status = 'paid', amount_cny, 0)) AS paid_cny
         FROM links WHERE client_id = $cid"
    )->fetch();
    // 已结：批次上的已结金额（管理员可改）+ 没挂批次的结算记录
    $settled = (float) $pdo->query("SELECT COALESCE(SUM(settled_amount), 0) FROM orders WHERE client_id = $cid")->fetchColumn()
        + (float) $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE client_id = $cid AND order_id IS NULL")->fetchColumn();
    $open = $pdo->query("SELECT COUNT(*) FROM orders WHERE client_id = $cid AND status = 'open'")->fetchColumn();
    // 还能领多少条：进行中、非线下批次的（目标 − 已付 − 手里待付）合计
    $claimable = (int) $pdo->query(
        "SELECT COALESCE(SUM(GREATEST(0, o.quantity - x.paid - x.holding)), 0) FROM orders o
         JOIN (SELECT o2.id, COALESCE(SUM(l.status = 'paid'), 0) paid, COALESCE(SUM(l.status IN ('claimed','checking')), 0) holding
               FROM orders o2 LEFT JOIN links l ON l.order_id = o2.id GROUP BY o2.id) x ON x.id = o.id
         WHERE o.client_id = $cid AND o.status = 'open' AND o.source = 'site'"
    )->fetchColumn();
    $sum = client_settle_map($cid)[$cid] ?? ['due' => 0.0, 'client_paid' => 0.0, 'client_profit' => 0.0];
    $due = $sum['due'];
    json_out([
        'ok' => true,
        'now' => now(),
        'client' => [
            'username' => $client['username'],
            'display_name' => $client['display_name'],
            // 原样给出（可能是以前选的其他网络），前端据此提示改成 Polygon
            'wallet_network' => (string) $client['wallet_network'],
            'wallet_network_name' => NETWORKS[$client['wallet_network']]['name'] ?? $client['wallet_network'],
            'wallet_network_ok' => network_enabled((string) $client['wallet_network']),
            'wallet_token' => in_array($client['wallet_token'], TOKENS, true) ? $client['wallet_token'] : 'USDT',
            'wallet_address' => $client['wallet_address'],
            'wallet_updated_at' => $client['wallet_updated_at'],
        ],
        'timeout_minutes' => (int) $client['claim_timeout_minutes'],
        'max_claim' => (int) $client['max_claim'],
        'stats' => [
            'claimed' => (int) $s['claimed'],
            'checking' => (int) $s['checking'],
            'paid' => (int) $s['paid'],
            'paid_today' => (int) $s['paid_today'],
            'paid_usd' => round((float) $s['paid_usd'], 2),
            'due' => $due,
            'profit' => $sum['client_profit'],
            'paid_cny' => round((float) $s['paid_cny'], 2),
            'settled' => round($settled, 2),
            'unsettled' => round(max(0, $due - $settled), 2),
            // 管理员预付、还没用掉的部分
            'prepaid' => round(max(0, $settled - $due), 2),
            'open_orders' => (int) $open,
            'claimable' => $claimable,
        ],
        'networks' => networks_public(),
        'tokens' => TOKENS,
    ]);
}

/** 客户看得到的批次字段（含进度与已付金额）；FROM orders o LEFT JOIN links l */
const CLIENT_ORDER_FIELDS = "o.id, o.code, o.tier, o.quantity, o.replace_limit, o.replaced, o.status, o.source, o.note, o.created_at, o.done_at,
        o.settle_status, o.settled_amount, o.settled_at, o.unit_price,
        " . DUE_SQL . " AS due_amount,
        " . DUE_SQL . " - COALESCE(SUM(IF(l.status = 'paid', l.amount_due, 0)), 0) AS profit,
        SUM(l.status = 'paid') AS paid, SUM(l.status IN ('claimed', 'checking')) AS holding,
        SUM(l.status IN ('superseded', 'refresh')) AS void,
        COALESCE(SUM(IF(l.status = 'paid', l.amount_due, 0)), 0) AS paid_usd, COALESCE(SUM(IF(l.status = 'paid', l.amount_cny, 0)), 0) AS paid_cny,
        (SELECT COUNT(*) FROM settlements s WHERE s.order_id = o.id) AS settlements
     FROM orders o LEFT JOIN links l ON l.order_id = o.id";

function with_remaining(array $o): array
{
    $o['remaining'] = $o['source'] === 'offline' ? 0 : max(0, (int) $o['quantity'] - (int) $o['paid'] - (int) $o['holding']);
    return $o;
}

function action_my_order(): never
{
    $client = require_login();
    $id = (int) ($_GET['id'] ?? 0);
    $cid = (int) $client['id'];
    $pdo = db();
    $stmt = $pdo->prepare('SELECT ' . CLIENT_ORDER_FIELDS . ' WHERE o.id = ? AND o.client_id = ? GROUP BY o.id');
    $stmt->execute([$id, $cid]);
    $o = $stmt->fetch();
    if (!$o) fail('批次不存在', 404, 'order_not_found');
    $links = $pdo->prepare(
        "SELECT id, IF(status IN ('superseded', 'refresh'), NULL, url) AS url, tier, amount_due, amount_cny,
                IF(status IN ('superseded', 'refresh'), 'void', status) AS status, claimed_at, paid_at
         FROM links WHERE order_id = ? AND client_id = ?
         ORDER BY FIELD(IF(status IN ('superseded', 'refresh'), 'void', status), 'claimed', 'checking', 'paid', 'void'), id"
    );
    $links->execute([$id, $cid]);
    json_out(['ok' => true, 'order' => with_remaining($o), 'links' => $links->fetchAll(),
        'settlements' => settlement_rows('s.order_id = ? AND s.client_id = ?', [$id, $cid], 100, 0)]);
}

function action_my_orders(): never
{
    $client = require_login();
    $in = $_GET + body();
    [$page, $size, $offset] = page_args($in, 10, 50);
    $where = ['o.client_id = ?'];
    $args = [(int) $client['id']];
    if (in_array($in['status'] ?? '', ['open', 'done', 'cancelled'], true)) {
        $where[] = 'o.status = ?';
        $args[] = $in['status'];
    }
    if (in_array($in['settle'] ?? '', ['unsettled', 'partial', 'settled', 'prepaid'], true)) {
        $where[] = 'o.settle_status = ?';
        $args[] = $in['settle'];
    }
    $sql = implode(' AND ', $where);
    $pdo = db();
    $total = $pdo->prepare("SELECT COUNT(*) FROM orders o WHERE $sql");
    $total->execute($args);
    $stmt = $pdo->prepare(
        "SELECT " . CLIENT_ORDER_FIELDS . "
         WHERE $sql GROUP BY o.id ORDER BY o.status = 'open' DESC, o.id DESC LIMIT $size OFFSET $offset"
    );
    $stmt->execute($args);
    $rows = array_map('with_remaining', $stmt->fetchAll());
    json_out(['ok' => true, 'total' => (int) $total->fetchColumn(), 'page' => $page, 'page_size' => $size, 'orders' => $rows]);
}

function action_my_claimed(): never
{
    $client = require_login();
    $in = $_GET + body();
    [$page, $size, $offset] = page_args($in, 20, 500);
    $cid = (int) $client['id'];
    $pdo = db();
    $where = "l.client_id = $cid AND l.status IN ('claimed', 'checking')";
    $args = [];
    if (!empty($in['order_id'])) {
        $where .= ' AND l.order_id = ?';
        $args[] = (int) $in['order_id'];
    }
    $total = $pdo->prepare("SELECT COUNT(*) FROM links l WHERE $where");
    $total->execute($args);
    $stmt = $pdo->prepare(
        "SELECT l.id, l.url, l.tier, l.amount_due, l.amount_cny, l.status, l.claimed_at, l.order_id, o.code, o.source
         FROM links l LEFT JOIN orders o ON o.id = l.order_id
         WHERE $where ORDER BY l.claimed_at DESC, l.id LIMIT $size OFFSET $offset"
    );
    $stmt->execute($args);
    $rows = $stmt->fetchAll();
    $timeout = (int) $client['claim_timeout_minutes'];
    foreach ($rows as &$r) $r['expires_in'] = max(0, strtotime((string) $r['claimed_at']) + $timeout * 60 - time());
    unset($r);
    json_out(['ok' => true, 'total' => (int) $total->fetchColumn(), 'page' => $page, 'page_size' => $size, 'links' => $rows]);
}

function action_my_paid(): never
{
    $client = require_login();
    $in = $_GET + body();
    [$page, $size, $offset] = page_args($in, 20, 200);
    $where = ["l.client_id = ?", "l.status = 'paid'"];
    $args = [(int) $client['id']];
    foreach (['from' => 'l.paid_at >= ?', 'to' => 'l.paid_at < DATE_ADD(?, INTERVAL 1 DAY)'] as $k => $cond) {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($in[$k] ?? ''))) {
            $where[] = $cond;
            $args[] = $in[$k];
        }
    }
    if (!empty($in['order_id'])) {
        $where[] = 'l.order_id = ?';
        $args[] = (int) $in['order_id'];
    }
    $sql = implode(' AND ', $where);
    $pdo = db();
    $sum = $pdo->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(l.amount_due), 0) AS usd, COALESCE(SUM(l.amount_cny), 0) AS cny FROM links l WHERE $sql");
    $sum->execute($args);
    $stmt = $pdo->prepare(
        "SELECT l.id, l.url, l.tier, l.amount_due, l.amount_cny, l.paid_at, l.order_id, o.code
         FROM links l LEFT JOIN orders o ON o.id = l.order_id
         WHERE $sql ORDER BY l.paid_at DESC, l.id DESC LIMIT $size OFFSET $offset"
    );
    $stmt->execute($args);
    $s = $sum->fetch();
    json_out(['ok' => true, 'total' => (int) $s['n'], 'sum_usd' => round((float) $s['usd'], 2), 'sum_cny' => round((float) $s['cny'], 2),
        'page' => $page, 'page_size' => $size, 'links' => $stmt->fetchAll()]);
}

/** 结算记录：每条带区块浏览器链接；凭证只给 id，走 action=proof 看 */
function settlement_rows(string $where, array $args, int $size, int $offset): array
{
    $stmt = db()->prepare(
        "SELECT s.id, s.client_id, COALESCE(c.display_name, c.username) AS client, s.order_id, o.code, s.amount, s.token, s.network,
                s.to_address, s.tx_hash, s.proof_file <> '' AS has_proof, s.proof_mime, s.note, s.created_by, s.paid_at, s.created_at
         FROM settlements s LEFT JOIN orders o ON o.id = s.order_id LEFT JOIN clients c ON c.id = s.client_id
         WHERE $where ORDER BY s.paid_at DESC, s.id DESC LIMIT $size OFFSET $offset"
    );
    $stmt->execute($args);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $n = NETWORKS[$r['network']] ?? null;
        $r['tx_url'] = $n && $r['tx_hash'] !== '' ? $n['explorer'] . $r['tx_hash'] : null;
        $r['network_name'] = $n['name'] ?? $r['network'];
        $r['has_proof'] = (bool) $r['has_proof'];
    }
    unset($r);
    return $rows;
}

function action_my_settlements(): never
{
    $client = require_login();
    $in = $_GET + body();
    [$page, $size, $offset] = page_args($in, 20, 100);
    $where = 's.client_id = ?';
    $args = [(int) $client['id']];
    if (!empty($in['order_id'])) {
        $where .= ' AND s.order_id = ?';
        $args[] = (int) $in['order_id'];
    }
    $total = db()->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM settlements s WHERE $where");
    $total->execute($args);
    $t = $total->fetch();
    json_out(['ok' => true, 'total' => (int) $t['n'], 'sum' => round((float) $t['sum'], 2), 'page' => $page, 'page_size' => $size,
        'settlements' => settlement_rows($where, $args, $size, $offset)]);
}

/**
 * 改收款地址：必须输当前密码（防止会话被盗后改地址把款截走）；改动记进管理日志，
 * 管理后台 24 小时内会提示「地址刚改过」，打款前核对一下。
 */
function action_wallet_save(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    $client = require_login();
    $in = body();
    if (!password_verify((string) ($in['password'] ?? ''), (string) $client['password_hash'])) fail('当前密码不正确', 400, 'bad_password');
    $network = (string) ($in['network'] ?? 'polygon');
    $token = strtoupper((string) ($in['token'] ?? 'USDT'));
    $address = trim((string) ($in['address'] ?? ''));
    if (!network_enabled($network)) fail('不支持这个网络', 400, 'bad_network');
    if (!in_array($token, TOKENS, true)) fail('不支持这个币种', 400, 'bad_token');
    if (!valid_address($network, $address)) fail('收款地址格式不对，请核对网络与地址', 400, 'bad_address');
    $t = now();
    db()->prepare('UPDATE clients SET wallet_network = ?, wallet_token = ?, wallet_address = ?, wallet_updated_at = ?, updated_at = ? WHERE id = ?')
        ->execute([$network, $token, $address, $t, $t, (int) $client['id']]);
    db()->prepare("INSERT INTO admin_log (at, actor, ip, op, detail) VALUES (?, ?, ?, 'wallet_save', ?)")->execute([
        $t, substr('client:' . $client['username'], 0, 32), substr(client_ip(), 0, 64),
        json_encode(['client_id' => (int) $client['id'], 'from' => $client['wallet_address'], 'to' => $address, 'network' => $network, 'token' => $token]),
    ]);
    json_out(['ok' => true]);
}

/** 看付款凭证：管理员都能看；客户只能看打给自己的 */
function action_proof(): never
{
    $id = (int) ($_GET['id'] ?? 0);
    $stmt = db()->prepare('SELECT client_id, proof_file, proof_mime FROM settlements WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || $row['proof_file'] === '') fail('凭证不存在', 404);
    $bearer = preg_match('/^Bearer\s+(.+)$/i', (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''), $m) ? trim($m[1]) : '';
    $desktop = $bearer !== '' && (string) (config()['sync_token'] ?? '') !== '' && hash_equals((string) config()['sync_token'], $bearer);
    if (!$desktop && !admin_session_ok()) {
        $client = current_client();
        if (!$client || (int) $client['id'] !== (int) $row['client_id']) fail('凭证不存在', 404);
    }
    send_proof((string) $row['proof_file'], (string) $row['proof_mime']);
}
