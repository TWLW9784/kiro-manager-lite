<?php
// 桌面端同步：一次请求做完三件事，返回服务器上的最新状态
//
// 请求体：
//   upsert:    [{url, account_ref, tier, amount_due, amount_cny, list_price, extracted_at}]  新提取的链接
//   supersede: [url_hash]                       已被桌面端新链接替换的旧链接
//   resolve:   [{url_hash, result: paid|expired}]  桌面端用 Kiro 档位确认过的 checking 链接
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
    $stats = ['inserted' => 0, 'superseded' => 0, 'resolved' => 0];

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

    $resolve = $pdo->prepare(
        "UPDATE links SET status = ?, paid_at = IF(? = 'paid', COALESCE(paid_at, ?), paid_at),
                refresh_reason = IF(? = 'refresh', 'expired', refresh_reason), updated_at = ?
         WHERE url_hash = ? AND status IN ('checking', 'claimed', 'available', 'refresh')"
    );
    foreach ((array) ($in['resolve'] ?? []) as $item) {
        $hash = (string) ($item['url_hash'] ?? '');
        $result = (string) ($item['result'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/', $hash) || !in_array($result, ['paid', 'expired'], true)) continue;
        $next = $result === 'paid' ? 'paid' : 'refresh';
        $resolve->execute([$next, $next, $t, $next, $t, $hash]);
        $stats['resolved'] += $resolve->rowCount();
    }

    $links = $pdo->query(
        "SELECT url_hash, account_ref, tier, amount_due, status, refresh_reason, claimed_at, paid_at, stripe_status
         FROM links WHERE status IN ('available', 'claimed', 'checking', 'refresh')
            OR (status = 'paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 3 DAY))"
    )->fetchAll();

    json_out(['ok' => true, 'now' => $t, 'stats' => $stats, 'links' => $links]);
}
