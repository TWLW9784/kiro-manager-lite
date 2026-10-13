<?php
// 客户侧批次操作：领取（只能在自己的批次额度内）、更换链接（不占额度，有次数上限）
declare(strict_types=1);

/** 从池子里给批次分 N 条同档位链接，最便宜的先给；FOR UPDATE 防并发重复领。调用方开事务 */
function assign_links(PDO $pdo, array $order, int $count): array
{
    if ($count <= 0) return [];
    $pick = $pdo->prepare(
        "SELECT id FROM links WHERE status = 'available' AND tier = ?
         ORDER BY amount_due IS NULL, amount_due, extracted_at LIMIT $count FOR UPDATE"
    );
    $pick->execute([$order['tier']]);
    $ids = array_map('intval', $pick->fetchAll(PDO::FETCH_COLUMN));
    if (!$ids) return [];
    $t = now();
    $marks = implode(',', $ids);
    $pdo->prepare(
        "UPDATE links SET status = 'claimed', client_id = ?, order_id = ?, claimed_at = ?, claim_batch = ?, updated_at = ?
         WHERE id IN ($marks)"
    )->execute([$order['client_id'], $order['id'], $t, $order['code'], $t]);
    return $ids;
}

/** 取客户自己的、还没完成的批次；不是自己的或已结束直接拒绝 */
function own_open_order(PDO $pdo, int $clientId, int $orderId): array
{
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? AND client_id = ? FOR UPDATE");
    $stmt->execute([$orderId, $clientId]);
    $order = $stmt->fetch();
    if (!$order) fail('批次不存在', 404, 'order_not_found');
    if ($order['status'] !== 'open') fail('这个批次已经结束', 400, 'order_closed');
    return $order;
}

/** 领取：在某个批次里领 N 条，不超过批次剩余额度（订单数 − 已付 − 手里待付） */
function action_claim(): never
{
    $client = require_login();
    $in = body();
    $orderId = (int) ($in['order_id'] ?? 0);
    if (!$orderId) fail('请先选择批次', 400, 'order_required');
    throttle_client((int) $client['id']);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $order = own_open_order($pdo, (int) $client['id'], $orderId);
        $stats = order_stats($orderId);
        $want = max(1, (int) ($in['count'] ?? $stats['remaining']));
        $count = min($want, $stats['remaining']);
        if ($count <= 0) {
            $pdo->rollBack();
            fail('这个批次的额度已经领完了', 400, 'order_full');
        }
        $ids = assign_links($pdo, $order, $count);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 池子里不够：差的部分桌面端看到批次缺口会自动去提取，稍后再点领取即可
    json_out(['ok' => true, 'claimed' => count($ids), 'short' => $count - count($ids), 'ids' => $ids]);
}

/**
 * 更换：这条作废（标记换新，旧链接由桌面端下架），从池子里立刻补一条同档位的进同一批次。
 * 不占批次额度，但每个批次最多换 replace_limit 次，防止无限刷。
 */
function action_replace(): never
{
    $client = require_login();
    $linkId = (int) (body()['id'] ?? 0);
    throttle_client((int) $client['id']);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $find = $pdo->prepare("SELECT * FROM links WHERE id = ? AND client_id = ? AND status = 'claimed' FOR UPDATE");
        $find->execute([$linkId, (int) $client['id']]);
        $link = $find->fetch();
        if (!$link || !$link['order_id']) {
            $pdo->rollBack();
            fail('这条链接不能更换', 400, 'cannot_replace');
        }
        $order = own_open_order($pdo, (int) $client['id'], (int) $link['order_id']);
        if ((int) $order['replaced'] >= (int) $order['replace_limit']) {
            $pdo->rollBack();
            fail('这个批次的更换次数已经用完，请联系管理员', 400, 'replace_limit');
        }
        $t = now();
        $pdo->prepare(
            "UPDATE links SET status = 'refresh', refresh_reason = 'replaced', updated_at = ? WHERE id = ?"
        )->execute([$t, $linkId]);
        $pdo->prepare('UPDATE orders SET replaced = replaced + 1, updated_at = ? WHERE id = ?')->execute([$t, $order['id']]);
        $ids = assign_links($pdo, $order, 1);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 池子空了就先作废旧的，补的那条等桌面端提取上来后在批次里点「领取」
    json_out(['ok' => true, 'new_id' => $ids[0] ?? null]);
}