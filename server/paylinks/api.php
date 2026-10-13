<?php
// 接口入口：?action=xxx
//   客户（登录会话）：login / logout / state / claim / release / export_paid
//   桌面端（同步密钥）：sync
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
require __DIR__ . '/inc/client.php';
require __DIR__ . '/inc/sync.php';
require __DIR__ . '/inc/admin.php';
require __DIR__ . '/inc/orders.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

try {
    $action = (string) ($_GET['action'] ?? '');
    match ($action) {
        'login' => action_login(),
        'logout' => action_logout(),
        'state' => action_state(),
        'claim' => action_claim(),
        'replace' => action_replace(),
        'release' => action_release(),
        'export_paid' => action_export_paid(),
        'sync' => action_sync(),
        'admin' => action_admin(),
        'admin_login' => action_admin_login(),
        'admin_logout' => action_admin_logout(),
        default => fail('未知操作', 404),
    };
} catch (Throwable $e) {
    error_log('[paylinks] ' . $e->getMessage());
    fail('服务器错误，请稍后再试', 500);
}
