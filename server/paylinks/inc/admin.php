<?php
// 管理接口：只给桌面端用（同步密钥认证），POST ?action=admin，请求体 {op, ...}
//   overview      总览：各状态 / 档位数量、近 14 天每天每个客户的付款数
//   clients       客户列表 + 每人的已领 / 已付统计
//   client_save   新建或修改客户（改密码会让该客户已登录的会话全部失效）
//   client_delete 删除客户（有已付款记录的不能删，只能停用，免得结算数据对不上）
//   client_kick   强制该客户重新登录
//   links         链接明细：按客户 / 状态 / 档位 / 日期筛选，分页
//   link_revoke   收回客户手里的链接（标记换新，旧链接作废）
//   link_resolve  手动定性卡在确认中的链接（桌面端找不到对应账号时用）
//   logs          管理操作日志
// 会改数据的操作成功后都记进 admin_log
declare(strict_types=1);

/** 会改数据、要留痕的操作 */
const ADMIN_LOGGED_OPS = [
    'client_save', 'client_delete', 'client_kick', 'link_revoke', 'link_resolve', 'order_create', 'order_update',
];

function action_admin(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    require_admin();
    release_timeouts();
    $in = body();
    $op = (string) ($in['op'] ?? '');
    // 成功才记：json_out 输出 ok=true 前回调这里（失败走 fail，不记）
    if (in_array($op, ADMIN_LOGGED_OPS, true)) {
        $detail = $in;
        unset($detail['op']);
        on_json_ok(static fn (array $out) => admin_log($op, $detail + array_intersect_key($out, ['id' => 1, 'code' => 1, 'revoked' => 1, 'resolved' => 1])));
    }
    match ($op) {
        'overview' => admin_overview(),
        'clients' => admin_clients(),
        'client_save' => admin_client_save($in),
        'client_delete' => admin_client_delete($in),
        'client_kick' => admin_client_kick($in),
        'links' => admin_links($in),
        'link_revoke' => admin_link_revoke($in),
        'link_resolve' => admin_link_resolve($in),
        'logs' => admin_logs($in),
        'orders' => admin_orders($in),
        'order_create' => admin_order_create($in),
        'order_update' => admin_order_update($in),
        default => fail('未知管理操作', 404),
    };
}

function admin_overview(): never
{
    $pdo = db();
    $byStatus = $pdo->query(
        "SELECT status, tier, COUNT(*) AS n, SUM(amount_due) AS usd, SUM(amount_cny) AS cny
         FROM links WHERE status <> 'superseded' GROUP BY status, tier"
    )->fetchAll();
    $daily = $pdo->query(
        "SELECT DATE(l.paid_at) AS day, l.client_id, COALESCE(c.display_name, c.username, '') AS client,
                COUNT(*) AS n, SUM(l.amount_due) AS usd, SUM(l.amount_cny) AS cny
         FROM links l LEFT JOIN clients c ON c.id = l.client_id
         WHERE l.status = 'paid' AND l.paid_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(l.paid_at), l.client_id ORDER BY day DESC, n DESC"
    )->fetchAll();
    $lastCheck = $pdo->query('SELECT MAX(stripe_checked_at) FROM links')->fetchColumn();
    // 确认中超过 30 分钟还没定性：多半是桌面端没开，或者对应账号已经不在桌面端了
    $stuck = (int) $pdo->query(
        "SELECT COUNT(*) FROM links WHERE status = 'checking' AND updated_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)"
    )->fetchColumn();
    json_out([
        'ok' => true,
        'now' => now(),
        'by_status' => $byStatus,
        'daily' => $daily,
        'last_stripe_check' => $lastCheck ?: null,
        'desktop' => meta_get('desktop_sync'),
        'stuck_checking' => $stuck,
    ]);
}

function admin_clients(): never
{
    $rows = db()->query(
        "SELECT c.id, c.username, c.display_name, c.enabled, c.max_claim, c.claim_timeout_minutes,
                c.note, c.last_login_at, c.created_at,
                SUM(l.status IN ('claimed', 'checking')) AS claimed,
                SUM(l.status = 'paid') AS paid,
                SUM(l.status = 'paid' AND l.paid_at >= CURDATE()) AS paid_today,
                SUM(IF(l.status = 'paid', l.amount_due, 0)) AS paid_usd,
                SUM(IF(l.status = 'paid', l.amount_cny, 0)) AS paid_cny,
                MAX(l.paid_at) AS last_paid_at
         FROM clients c LEFT JOIN links l ON l.client_id = c.id
         GROUP BY c.id ORDER BY c.id"
    )->fetchAll();
    json_out(['ok' => true, 'clients' => $rows]);
}

function admin_client_save(array $in): never
{
    $pdo = db();
    $id = (int) ($in['id'] ?? 0);
    $username = trim((string) ($in['username'] ?? ''));
    $password = (string) ($in['password'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username)) fail('账号只能用 3-32 位字母、数字、_ . -');
    if ($password !== '' && strlen($password) < 8) fail('密码至少 8 位');
    if (!$id && $password === '') fail('新建客户必须设置密码');

    $fields = [
        'username' => $username,
        'display_name' => mb_substr(trim((string) ($in['display_name'] ?? '')), 0, 64),
        'enabled' => !empty($in['enabled']) ? 1 : 0,
        'max_claim' => max(1, min(500, (int) ($in['max_claim'] ?? 50))),
        'claim_timeout_minutes' => max(10, min(7 * 24 * 60, (int) ($in['claim_timeout_minutes'] ?? 180))),
        'note' => mb_substr(trim((string) ($in['note'] ?? '')), 0, 255),
    ];
    $dup = $pdo->prepare('SELECT id FROM clients WHERE username = ? AND id <> ?');
    $dup->execute([$username, $id]);
    if ($dup->fetch()) fail('这个账号名已经有人用了');

    $t = now();
    if ($id) {
        $sets = implode(', ', array_map(fn ($k) => "$k = ?", array_keys($fields)));
        $values = array_values($fields);
        // 改密码或停用：作废已登录的会话
        $bump = $password !== '' || !$fields['enabled'];
        if ($password !== '') {
            $sets .= ', password_hash = ?';
            $values[] = password_hash($password, PASSWORD_DEFAULT);
        }
        if ($bump) $sets .= ', session_version = session_version + 1';
        $values[] = $t;
        $values[] = $id;
        $stmt = $pdo->prepare("UPDATE clients SET $sets, updated_at = ? WHERE id = ?");
        $stmt->execute($values);
        if (!$stmt->rowCount()) fail('客户不存在', 404);
    } else {
        $cols = implode(', ', array_keys($fields));
        $marks = implode(', ', array_fill(0, count($fields), '?'));
        $pdo->prepare("INSERT INTO clients ($cols, password_hash, created_at, updated_at) VALUES ($marks, ?, ?, ?)")
            ->execute([...array_values($fields), password_hash($password, PASSWORD_DEFAULT), $t, $t]);
        $id = (int) $pdo->lastInsertId();
    }
    json_out(['ok' => true, 'id' => $id]);
}

function admin_client_delete(array $in): never
{
    $id = (int) ($in['id'] ?? 0);
    $pdo = db();
    $paid = $pdo->prepare("SELECT COUNT(*) FROM links WHERE client_id = ? AND status = 'paid'");
    $paid->execute([$id]);
    if ((int) $paid->fetchColumn() > 0) fail('这个客户有已付款记录，删除会让结算对不上，请改为停用');
    // 手里还没付的收回换新
    $t = now();
    $pdo->prepare(
        "UPDATE links SET status = 'refresh', refresh_reason = 'revoked', updated_at = ?
         WHERE client_id = ? AND status IN ('claimed', 'checking')"
    )->execute([$t, $id]);
    $stmt = $pdo->prepare('DELETE FROM clients WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->rowCount()) fail('客户不存在', 404);
    json_out(['ok' => true]);
}

function admin_client_kick(array $in): never
{
    $stmt = db()->prepare('UPDATE clients SET session_version = session_version + 1, updated_at = ? WHERE id = ?');
    $stmt->execute([now(), (int) ($in['id'] ?? 0)]);
    if (!$stmt->rowCount()) fail('客户不存在', 404);
    json_out(['ok' => true]);
}

/** 链接明细：按客户 / 状态 / 档位 / 付款日期筛选，按最近变动倒序，分页 */
function admin_links(array $in): never
{
    $where = ["l.status <> 'superseded'"];
    $args = [];
    if (!empty($in['client_id'])) {
        $where[] = 'l.client_id = ?';
        $args[] = (int) $in['client_id'];
    }
    $statuses = array_values(array_intersect(
        (array) ($in['statuses'] ?? []),
        ['available', 'claimed', 'checking', 'paid', 'refresh']
    ));
    if ($statuses) {
        $where[] = 'l.status IN (' . implode(',', array_fill(0, count($statuses), '?')) . ')';
        array_push($args, ...$statuses);
    }
    if (!empty($in['tier'])) {
        $where[] = 'l.tier = ?';
        $args[] = (string) $in['tier'];
    }
    if (!empty($in['order_id'])) {
        $where[] = 'l.order_id = ?';
        $args[] = (int) $in['order_id'];
    }
    // 搜索：链接里的任意一段（会话号 cs_live_…）或批次号
    $q = trim((string) ($in['q'] ?? ''));
    if ($q !== '') {
        $where[] = '(l.url LIKE ? OR l.claim_batch LIKE ?)';
        $like = '%' . addcslashes($q, '%_\\') . '%';
        array_push($args, $like, $like);
    }
    foreach (['from' => '>=', 'to' => '<'] as $key => $op) {
        $day = (string) ($in[$key] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) continue;
        $where[] = $key === 'from' ? 'l.paid_at >= ?' : 'l.paid_at < DATE_ADD(?, INTERVAL 1 DAY)';
        $args[] = $day;
    }
    $sql = implode(' AND ', $where);
    $pdo = db();
    $total = $pdo->prepare("SELECT COUNT(*) FROM links l WHERE $sql");
    $total->execute($args);
    $page = max(1, (int) ($in['page'] ?? 1));
    $size = max(10, min(500, (int) ($in['page_size'] ?? 50)));
    $offset = ($page - 1) * $size;
    $stmt = $pdo->prepare(
        "SELECT l.id, l.url_hash, l.account_ref, l.url, l.tier, l.amount_due, l.amount_cny, l.status,
                l.client_id, COALESCE(c.display_name, c.username) AS client, l.claimed_at, l.paid_at,
                l.refresh_reason, l.stripe_status, l.stripe_checked_at, l.extracted_at, l.updated_at
         FROM links l LEFT JOIN clients c ON c.id = l.client_id
         WHERE $sql ORDER BY l.updated_at DESC, l.id DESC LIMIT $size OFFSET $offset"
    );
    $stmt->execute($args);
    json_out(['ok' => true, 'total' => (int) $total->fetchColumn(), 'links' => $stmt->fetchAll()]);
}

/** 收回：客户手里没付的标记换新，旧链接作废（桌面端下一轮换新链接再上架） */
function admin_link_revoke(array $in): never
{
    $ids = array_values(array_filter(array_map('intval', (array) ($in['ids'] ?? []))));
    if (!$ids) fail('请选择链接');
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare(
        "UPDATE links SET status = 'refresh', refresh_reason = 'revoked', updated_at = ?
         WHERE id IN ($marks) AND status IN ('claimed', 'checking', 'available')"
    );
    $stmt->execute([now(), ...$ids]);
    json_out(['ok' => true, 'revoked' => $stmt->rowCount()]);
}

/**
 * 手动定性确认中的链接。正常由桌面端查 Kiro 档位回报；桌面端里账号删了、或者确实知道结果时用。
 * 同一个号只允许一条已付，免得重复结算。
 */
function admin_link_resolve(array $in): never
{
    $id = (int) ($in['id'] ?? 0);
    $result = (string) ($in['result'] ?? '');
    if (!in_array($result, ['paid', 'expired'], true)) fail('结果只能是 paid 或 expired');
    $pdo = db();
    $row = $pdo->prepare("SELECT account_ref, status FROM links WHERE id = ?");
    $row->execute([$id]);
    $link = $row->fetch();
    if (!$link) fail('链接不存在', 404);
    if ($link['status'] !== 'checking') fail('只能定性「确认中」的链接');
    if ($result === 'paid') {
        $dup = $pdo->prepare("SELECT COUNT(*) FROM links WHERE account_ref = ? AND status = 'paid'");
        $dup->execute([$link['account_ref']]);
        if ((int) $dup->fetchColumn() > 0) fail('这个账号已经有一条记成已付款了，不能重复记');
    }
    $t = now();
    $pdo->prepare(
        $result === 'paid'
            ? "UPDATE links SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ? AND status = 'checking'"
            : "UPDATE links SET status = 'refresh', refresh_reason = 'expired', updated_at = ? WHERE id = ? AND status = 'checking'"
    )->execute($result === 'paid' ? [$t, $t, $id] : [$t, $id]);
    close_done_orders();
    json_out(['ok' => true, 'resolved' => 1]);
}

/** 管理操作日志，最新在前 */
function admin_logs(array $in): never
{
    $size = max(10, min(200, (int) ($in['page_size'] ?? 100)));
    $stmt = db()->query("SELECT id, at, actor, ip, op, detail FROM admin_log ORDER BY id DESC LIMIT $size");
    json_out(['ok' => true, 'logs' => $stmt->fetchAll()]);
}

// ============ 订单批次 ============

/** 批次列表：可按客户 / 状态筛选，带进度 */
function admin_orders(array $in): never
{
    $where = ['1 = 1'];
    $args = [];
    if (!empty($in['client_id'])) {
        $where[] = 'o.client_id = ?';
        $args[] = (int) $in['client_id'];
    }
    if (!empty($in['status']) && in_array($in['status'], ['open', 'done', 'cancelled'], true)) {
        $where[] = 'o.status = ?';
        $args[] = $in['status'];
    }
    $sql = implode(' AND ', $where);
    $stmt = db()->prepare(
        "SELECT o.*, COALESCE(c.display_name, c.username) AS client,
                SUM(l.status = 'paid') AS paid, SUM(l.status IN ('claimed', 'checking')) AS holding,
                SUM(IF(l.status = 'paid', l.amount_due, 0)) AS paid_usd, SUM(IF(l.status = 'paid', l.amount_cny, 0)) AS paid_cny
         FROM orders o LEFT JOIN clients c ON c.id = o.client_id LEFT JOIN links l ON l.order_id = o.id
         WHERE $sql GROUP BY o.id ORDER BY o.status = 'open' DESC, o.id DESC LIMIT 200"
    );
    $stmt->execute($args);
    json_out(['ok' => true, 'orders' => $stmt->fetchAll()]);
}

/** 派单：给客户开一个批次（档位 × 数量），更换上限默认等于数量 */
function admin_order_create(array $in): never
{
    $pdo = db();
    $clientId = (int) ($in['client_id'] ?? 0);
    $tier = substr(trim((string) ($in['tier'] ?? '')), 0, 16);
    $qty = (int) ($in['quantity'] ?? 0);
    if ($qty < 1 || $qty > 500) fail('数量在 1 到 500 之间');
    if ($tier === '') fail('请选择档位');
    $ok = $pdo->prepare('SELECT id FROM clients WHERE id = ?');
    $ok->execute([$clientId]);
    if (!$ok->fetch()) fail('客户不存在', 404);
    $limit = isset($in['replace_limit']) ? max(0, min(1000, (int) $in['replace_limit'])) : $qty;
    $t = now();
    // 批次号：B + 年月日 + 当天序号，按批次核对时好认。两人同时派单撞号时（uk_code）顺延重试
    $prefix = 'B' . date('ymd') . '-';
    $last = $pdo->prepare('SELECT code FROM orders WHERE code LIKE ? ORDER BY LENGTH(code) DESC, code DESC LIMIT 1');
    $last->execute([$prefix . '%']);
    $seq = (int) substr((string) $last->fetchColumn(), strlen($prefix)) + 1;
    $insert = $pdo->prepare(
        "INSERT INTO orders (code, client_id, tier, quantity, replace_limit, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $note = mb_substr(trim((string) ($in['note'] ?? '')), 0, 255);
    for ($try = 0; ; $try++, $seq++) {
        $code = sprintf('%s%02d', $prefix, $seq);
        try {
            $insert->execute([$code, $clientId, $tier, $qty, $limit, $note, $t, $t]);
            break;
        } catch (PDOException $e) {
            if ($e->errorInfo[1] !== 1062 || $try >= 5) throw $e;
        }
    }
    json_out(['ok' => true, 'id' => (int) $pdo->lastInsertId(), 'code' => $code]);
}

/**
 * 改批次：调更换上限 / 数量，或取消。取消时客户手里没付的收回换新，已付的保留照常结算。
 */
function admin_order_update(array $in): never
{
    $pdo = db();
    $id = (int) ($in['id'] ?? 0);
    $t = now();
    if (($in['status'] ?? '') === 'cancelled') {
        $pdo->prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open'")->execute([$t, $id]);
        $pdo->prepare(
            "UPDATE links SET status = 'refresh', refresh_reason = 'revoked', updated_at = ?
             WHERE order_id = ? AND status IN ('claimed', 'checking')"
        )->execute([$t, $id]);
        json_out(['ok' => true]);
    }
    $sets = [];
    $args = [];
    if (isset($in['quantity'])) {
        $sets[] = 'quantity = ?';
        $args[] = max(1, min(500, (int) $in['quantity']));
    }
    if (isset($in['replace_limit'])) {
        $sets[] = 'replace_limit = ?';
        $args[] = max(0, min(1000, (int) $in['replace_limit']));
    }
    if (!$sets) fail('没有要改的');
    $args[] = $t;
    $args[] = $id;
    $pdo->prepare('UPDATE orders SET ' . implode(', ', $sets) . ', updated_at = ? WHERE id = ?')->execute($args);
    close_done_orders();
    json_out(['ok' => true]);
}

// ============ 管理员网页登录 ============

function action_admin_login(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    $ip = client_ip();
    $pdo = db();
    $recent = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > DATE_SUB(?, INTERVAL 15 MINUTE)');
    $recent->execute([$ip, now()]);
    if ((int) $recent->fetchColumn() >= 5) fail('尝试次数过多，请 15 分钟后再试', 429, 'too_many_attempts');
    $admin = config()['admin'] ?? null;
    $in = body();
    $ok = $admin
        && hash_equals((string) $admin['username'], (string) ($in['username'] ?? ''))
        && password_verify((string) ($in['password'] ?? ''), (string) $admin['password_hash']);
    if (!$ok) {
        $pdo->prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)')->execute([$ip, now()]);
        fail('账号或密码不正确', 401, 'bad_credentials');
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['admin'] = $admin['username'];
    $_SESSION['admin_csrf'] = bin2hex(random_bytes(16));
    json_out(['ok' => true, 'csrf' => $_SESSION['admin_csrf']]);
}

function action_admin_logout(): never
{
    start_session();
    unset($_SESSION['admin'], $_SESSION['admin_csrf']);
    json_out(['ok' => true]);
}
