<?php
// 桌面端同步：一次请求做完三件事，返回服务器上的最新状态
//
// 请求体：
//   upsert:    [{url, account_ref, tier, amount_due, amount_cny, list_price, extracted_at}]  新提取的链接
//   supersede: [url_hash]                       已被桌面端新链接替换的旧链接
//   resolve:   [{url_hash, result: paid|expired}]  桌面端用 Kiro 档位确认过的 checking 链接
//   relist:    [url_hash]                       换新时 Kiro 返回了同一个会话，链接没变，放回可领取
// 返回：所有未结束的链接（available / claimed / checking / refresh）+ 最近 3 天付款的，
//      桌面端据此换新链接、确认付款、同步标记。
declare(strict_types=1);

function action_sync(): never
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('请用 POST', 405);
    require_sync_token();
    release_timeouts();
    $in = body();
    $pdo = db();
    $t = now();
    $stats = ['inserted' => 0, 'superseded' => 0, 'resolved' => 0, 'relisted' => 0];
    // 桌面端心跳：后台总览据此判断桌面端是不是还开着
    $client = (array) ($in['client'] ?? []);
    meta_set('desktop_sync', [
        'at' => $t,
        'version' => mb_substr((string) ($client['version'] ?? ''), 0, 32),
        'last_summary' => mb_substr((string) ($client['last_summary'] ?? ''), 0, 200),
        'last_error' => mb_substr((string) ($client['last_error'] ?? ''), 0, 200),
    ]);

    $insert = $pdo->prepare(
        "INSERT IGNORE INTO links (url_hash, url, account_ref, tier, amount_due, amount_cny, list_price,
                                   status, extracted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)"
    );
    foreach ((array) ($in['upsert'] ?? []) as $item) {
        $url = (string) ($item['url'] ?? '');
        $ref = (string) ($item['account_ref'] ?? '');
        if (!preg_match('#^https://checkout\.stripe\.com/#', $url) || !preg_match('/^[a-f0-9]{64}$/', $ref)) continue;
        $num = static fn ($v) => is_numeric($v) ? round((float) $v, 2) : null;
        $at = is_numeric($item['extracted_at'] ?? null) ? date('Y-m-d H:i:s', (int) ($item['extracted_at'] / 1000)) : $t;
        $insert->execute([
            hash('sha256', $url), $url, $ref, substr((string) ($item['tier'] ?? ''), 0, 16),
            $num($item['amount_due'] ?? null), $num($item['amount_cny'] ?? null), $num($item['list_price'] ?? null),
            $at, $t, $t,
        ]);
        $stats['inserted'] += $insert->rowCount();
    }

    // 只替换还没卖出去的：已领走、已付款的保留原样，免得客户手里的链接突然消失
    $supersede = $pdo->prepare(
        "UPDATE links SET status = 'superseded', updated_at = ? WHERE url_hash = ? AND status IN ('available', 'refresh')"
    );
    foreach ((array) ($in['supersede'] ?? []) as $hash) {
        if (!is_string($hash) || !preg_match('/^[a-f0-9]{64}$/', $hash)) continue;
        $supersede->execute([$t, $hash]);
        $stats['superseded'] += $supersede->rowCount();
    }

    /*
     * 回报付款结果。已付：也可以是已下架（superseded）但被客户领过的旧链接——
     * 客户手里还留着旧链接（TXT、截图）照样能付，不记的话结算会漏。
     * 一个号只能记一条已付：已经有一条了，这条就按失效处理，免得重复结算。
     */
    $paidOf = $pdo->prepare("SELECT COUNT(*) FROM links WHERE account_ref = (SELECT account_ref FROM links WHERE url_hash = ?) AND status = 'paid'");
    $markPaid = $pdo->prepare(
        "UPDATE links SET status = 'paid', paid_at = COALESCE(paid_at, ?), refresh_reason = NULL, updated_at = ?
         WHERE url_hash = ? AND (status IN ('checking', 'claimed', 'available', 'refresh')
                                 OR (status = 'superseded' AND claimed_at IS NOT NULL))"
    );
    $markExpired = $pdo->prepare(
        "UPDATE links SET status = 'refresh', refresh_reason = 'expired', updated_at = ?
         WHERE url_hash = ? AND status IN ('checking', 'claimed', 'available', 'refresh')"
    );
    foreach ((array) ($in['resolve'] ?? []) as $item) {
        $hash = (string) ($item['url_hash'] ?? '');
        $result = (string) ($item['result'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash) || !in_array($result, ['paid', 'expired'], true)) continue;
        if ($result === 'paid') {
            $paidOf->execute([$hash]);
            if ((int) $paidOf->fetchColumn() > 0) $result = 'expired';
        }
        $stmt = $result === 'paid' ? $markPaid : $markExpired;
        $stmt->execute($result === 'paid' ? [$t, $t, $hash] : [$t, $hash]);
        $stats['resolved'] += $stmt->rowCount();
    }

    /*
     * 换不出新链接、但旧链接还能付：重新上架。
     *
     * 实测 Kiro 的 GenerateSubscriptionManagementUrl 对同一个账号常常返回同一个 Checkout Session，
     * 于是「换新」拿到的 url 和旧的一模一样，INSERT IGNORE 跳过、这行一直停在 refresh，
     * 桌面端每轮都再试一次，变成死循环。桌面端发现 url 没变就发 relist，这里放回可领取。
     */
    $relist = $pdo->prepare(
        "UPDATE links SET status = 'available', refresh_reason = NULL, client_id = NULL,
                claimed_at = NULL, claim_batch = NULL, updated_at = ?
         WHERE url_hash = ? AND status = 'refresh'"
    );
    foreach ((array) ($in['relist'] ?? []) as $hash) {
        if (!is_string($hash) || !preg_match('/^[a-f0-9]{64}$/', $hash)) continue;
        $relist->execute([$t, $hash]);
        $stats['relisted'] = ($stats['relisted'] ?? 0) + $relist->rowCount();
    }

    $links = $pdo->query(
        "SELECT url_hash, account_ref, tier, amount_due, status, refresh_reason, claimed_at, paid_at, stripe_status
         FROM links WHERE status IN ('available', 'claimed', 'checking', 'refresh')
            OR (status = 'paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 3 DAY))
            -- 被领过又下架的旧链接：桌面端发现号已付费时据此补记已付
            -- 已经有一条记成已付的号不再返回，免得桌面端每轮重复回报
            OR (status = 'superseded' AND claimed_at IS NOT NULL AND updated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
                AND NOT EXISTS (SELECT 1 FROM links p WHERE p.account_ref = links.account_ref AND p.status = 'paid'))"
    )->fetchAll();

    close_done_orders();

    /*
     * 缺口：进行中的批次还要多少条 − 池子里同档位可领的。桌面端按这个数自动提取，
     * 派了单、池子不够时不用人去点「开始提取」。
     */
    $demand = $pdo->query(
        "SELECT o.tier,
                GREATEST(0, SUM(o.quantity) - SUM(COALESCE(x.paid, 0)) - SUM(COALESCE(x.holding, 0))) AS need
         FROM orders o LEFT JOIN (
           SELECT order_id, SUM(status = 'paid') AS paid, SUM(status IN ('claimed', 'checking')) AS holding
           FROM links WHERE order_id IS NOT NULL GROUP BY order_id
         ) x ON x.order_id = o.id
         WHERE o.status = 'open' GROUP BY o.tier"
    )->fetchAll();
    $pool = [];
    foreach ($pdo->query("SELECT tier, COUNT(*) AS n FROM links WHERE status = 'available' GROUP BY tier") as $r) {
        $pool[$r['tier']] = (int) $r['n'];
    }
    $shortage = [];
    foreach ($demand as $d) {
        $gap = (int) $d['need'] - ($pool[$d['tier']] ?? 0);
        if ($gap > 0) $shortage[$d['tier']] = $gap;
    }

    json_out(['ok' => true, 'now' => $t, 'stats' => $stats, 'links' => $links, 'shortage' => $shortage]);
}
