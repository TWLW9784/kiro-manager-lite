<?php
// 计划任务：每分钟跑一次（宝塔「计划任务 → Shell 脚本」：php /www/wwwroot/paylinks.yonghu.shop/cron/check.php）
//
// 1. 领走超过 3 小时未付的放回（标记 refresh，等桌面端换新链接）
// 2. 向 Stripe 查链接状态：已领走的每分钟查，可领取的每 10 分钟查（发现失效就下架）
// 只允许命令行运行；加锁防止上一轮没跑完又起一轮。
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../inc/lib.php';

$lock = fopen(sys_get_temp_dir() . '/paylinks-check.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo "previous run still in progress\n";
    exit;
}

$released = release_timeouts();

$rows = db()->query(
    "SELECT url_hash, url FROM links
     WHERE (status = 'claimed' AND (stripe_checked_at IS NULL OR stripe_checked_at < DATE_SUB(NOW(), INTERVAL 50 SECOND)))
        OR (status = 'available' AND (stripe_checked_at IS NULL OR stripe_checked_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)))
     ORDER BY status = 'claimed' DESC, stripe_checked_at IS NULL DESC, stripe_checked_at
     LIMIT 400"
)->fetchAll();

$count = $rows ? apply_stripe_statuses(stripe_statuses($rows)) : ['paid' => 0, 'checking' => 0, 'refresh' => 0];

printf(
    "[%s] checked %d, paid %d, checking %d, refresh %d, timeout-released %d\n",
    now(), count($rows), $count['paid'], $count['checking'], $count['refresh'], $released
);
