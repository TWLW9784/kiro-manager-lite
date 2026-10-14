<?php
// 结算（管理员）：给客户打款（虚拟币，默认 Polygon 上的 USDT）后记一笔，挂到批次上，附交易哈希与凭证
//   order_settle      直接改批次的结算状态 / 已结金额 / 备注（JSON，走 action=admin）
//   settlements       结算记录列表（JSON，走 action=admin）
//   settlement_delete 删一笔结算记录，批次已结金额同步扣回（JSON，走 action=admin）
//   settlement_add    记一笔（multipart，带凭证文件；走 action=settlement_add）
declare(strict_types=1);

/** 按结算记录重算批次的已结金额与状态 */
function recompute_order_settle(int $orderId): void
{
    $pdo = db();
    $sum = (float) $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE order_id = $orderId")->fetchColumn();
    $status = settle_status_for(order_due($orderId), $sum);
    $pdo->prepare("UPDATE orders SET settled_amount = ?, settle_status = ?, settled_at = IF(? = 'unsettled', NULL, COALESCE(settled_at, ?)), updated_at = ? WHERE id = ?")
        ->execute([round($sum, 2), $status, $status, now(), now(), $orderId]);
}

/** 手动改：状态 / 已结金额 / 备注，三个都可单独改 */
function admin_order_settle(array $in): never
{
    $id = (int) ($in['id'] ?? 0);
    $pdo = db();
    $row = $pdo->prepare('SELECT id FROM orders WHERE id = ?');
    $row->execute([$id]);
    if (!$row->fetch()) fail('批次不存在', 404);
    $sets = [];
    $args = [];
    if (isset($in['settle_status'])) {
        if (!in_array($in['settle_status'], ['unsettled', 'partial', 'settled', 'prepaid'], true)) fail('结算状态不对');
        $sets[] = 'settle_status = ?';
        $args[] = $in['settle_status'];
        $sets[] = "settled_at = IF(? = 'unsettled', NULL, COALESCE(settled_at, ?))";
        array_push($args, $in['settle_status'], now());
    }
    if (isset($in['settled_amount'])) {
        if (!is_numeric($in['settled_amount']) || (float) $in['settled_amount'] < 0) fail('已结金额不对');
        $sets[] = 'settled_amount = ?';
        $args[] = round((float) $in['settled_amount'], 2);
    }
    if (array_key_exists('unit_price', $in)) {
        $sets[] = 'unit_price = ?';
        $args[] = unit_price_or_null($in['unit_price']);
    }
    if (isset($in['settle_note'])) {
        $sets[] = 'settle_note = ?';
        $args[] = clean_text($in['settle_note'], 255, '结算备注');
    }
    if (!$sets) fail('没有要改的');
    $args[] = now();
    $args[] = $id;
    $pdo->prepare('UPDATE orders SET ' . implode(', ', $sets) . ', updated_at = ? WHERE id = ?')->execute($args);
    // 只改了单价（没手动指定状态）：按新的应结重算状态
    if (array_key_exists('unit_price', $in) && !isset($in['settle_status'])) {
        $amt = (float) $pdo->query("SELECT settled_amount FROM orders WHERE id = $id")->fetchColumn();
        $pdo->prepare('UPDATE orders SET settle_status = ? WHERE id = ?')->execute([settle_status_for(order_due($id), $amt), $id]);
    }
    json_out(['ok' => true, 'id' => $id]);
}

function admin_settlements(array $in): never
{
    [$page, $size, $offset] = page_args($in, 20, 100);
    $where = ['1 = 1'];
    $args = [];
    foreach (['client_id' => 's.client_id = ?', 'order_id' => 's.order_id = ?'] as $k => $cond) {
        if (!empty($in[$k])) {
            $where[] = $cond;
            $args[] = (int) $in[$k];
        }
    }
    $sql = implode(' AND ', $where);
    $total = db()->prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS sum FROM settlements s WHERE $sql");
    $total->execute($args);
    $t = $total->fetch();
    json_out(['ok' => true, 'total' => (int) $t['n'], 'sum' => round((float) $t['sum'], 2), 'page' => $page, 'page_size' => $size,
        'settlements' => settlement_rows($sql, $args, $size, $offset)]);
}

function admin_settlement_delete(array $in): never
{
    $id = (int) ($in['id'] ?? 0);
    $pdo = db();
    $row = $pdo->prepare('SELECT order_id, proof_file FROM settlements WHERE id = ?');
    $row->execute([$id]);
    $s = $row->fetch();
    if (!$s) fail('结算记录不存在', 404);
    $pdo->prepare('DELETE FROM settlements WHERE id = ?')->execute([$id]);
    if ($s['proof_file'] !== '') @unlink(proofs_dir() . '/' . basename((string) $s['proof_file']));
    if ($s['order_id']) recompute_order_settle((int) $s['order_id']);
    json_out(['ok' => true, 'id' => $id]);
}

/**
 * 记一笔结算（multipart/form-data）：client_id、order_id（可空）、amount、token、network、to_address、tx_hash、paid_at、note、proof（文件，可选）。
 * 收款地址默认用客户填的，这里存一份快照：之后客户改了地址，这笔记录上还是当时打的那个。
 */
function action_settlement_add(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    require_admin();
    $in = $_POST;
    $pdo = db();
    $clientId = (int) ($in['client_id'] ?? 0);
    $client = $pdo->prepare('SELECT id, username, wallet_network, wallet_token, wallet_address FROM clients WHERE id = ?');
    $client->execute([$clientId]);
    $c = $client->fetch();
    if (!$c) fail('客户不存在', 404);
    $orderId = (int) ($in['order_id'] ?? 0) ?: null;
    if ($orderId) {
        $o = $pdo->prepare('SELECT id FROM orders WHERE id = ? AND client_id = ?');
        $o->execute([$orderId, $clientId]);
        if (!$o->fetch()) fail('批次不属于这个客户');
    }
    $amount = (float) ($in['amount'] ?? 0);
    if (!is_numeric($in['amount'] ?? null) || $amount <= 0 || $amount > 1e7) fail('金额不对');
    // 只走 Polygon；客户以前填的是别的网络时，地址不能默认带过来（同一串地址换网络可能收不到）
    $network = (string) ($in['network'] ?? '') ?: 'polygon';
    if (!network_enabled($network)) fail('只支持 Polygon 网络');
    $token = strtoupper((string) ($in['token'] ?? '') ?: (string) $c['wallet_token']);
    if (!in_array($token, TOKENS, true)) fail('不支持这个币种');
    $to = trim((string) ($in['to_address'] ?? '')) ?: ($c['wallet_network'] === $network ? (string) $c['wallet_address'] : '');
    if ($to !== '' && !valid_address($network, $to)) fail('收款地址和网络对不上');
    $tx = trim((string) ($in['tx_hash'] ?? ''));
    if ($tx !== '' && !valid_tx_hash($network, $tx)) fail('交易哈希格式不对');
    $paidAt = preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/', (string) ($in['paid_at'] ?? '')) ? str_replace('T', ' ', substr((string) $in['paid_at'], 0, 16)) . ':00' : now();
    // 备注必须是合法 UTF-8：不是的话 MySQL 会抛错变成 500，这里提前拦成能看懂的提示
    $note = clean_text($in['note'] ?? '', 255, '备注');
    // 交易哈希和凭证都是选填：线下付款、现金、或者先记账后补凭证都很常见。
    // 以前强制「至少给一个」，结果管理员绕开打款记录、直接手改批次的已结金额，账反而对不上
    [$file, $mime] = !empty($_FILES['proof']['name']) ? store_proof($_FILES['proof']) : ['', ''];
    $actor = !empty($_SERVER['HTTP_AUTHORIZATION']) ? 'desktop' : (string) ($_SESSION['admin'] ?? 'admin');
    try {
        $pdo->prepare(
            'INSERT INTO settlements (client_id, order_id, amount, token, network, to_address, tx_hash, proof_file, proof_mime, note, created_by, paid_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$clientId, $orderId, round($amount, 2), $token, $network, $to, $tx, $file, $mime,
            $note, substr($actor, 0, 32), $paidAt, now()]);
    } catch (Throwable $e) {
        // 入库失败就把刚写进去的凭证删掉，否则磁盘上会留下没人引用的孤儿文件
        if ($file !== '') @unlink(proofs_dir() . '/' . $file);
        throw $e;
    }
    $id = (int) $pdo->lastInsertId();
    if ($orderId) recompute_order_settle($orderId);
    admin_log('settlement_add', ['id' => $id, 'client_id' => $clientId, 'order_id' => $orderId, 'amount' => round($amount, 2),
        'token' => $token, 'network' => $network, 'to' => $to, 'tx' => $tx, 'proof' => $file !== '']);
    json_out(['ok' => true, 'id' => $id]);
}
