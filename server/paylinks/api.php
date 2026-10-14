<?php
// 接口入口：?action=xxx
//   客户（登录会话）：login / logout / state / claim / release / export_paid，
//                     门户分页接口 me / my_orders / my_claimed / my_paid / my_settlements / wallet_save / proof
//   管理员：admin（JSON，{op}）、settlement_add（multipart，带凭证）
//   桌面端（同步密钥）：sync
declare(strict_types=1);
require __DIR__ . '/inc/lib.php';
require __DIR__ . '/inc/client.php';
require __DIR__ . '/inc/sync.php';
require __DIR__ . '/inc/admin.php';
require __DIR__ . '/inc/orders.php';
require __DIR__ . '/inc/portal.php';
require __DIR__ . '/inc/settle.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

try {
    $action = (string) ($_GET['action'] ?? '');
    match ($action) {
        'login' => action_login(),
        'order_links' => action_order_links(),
        'logout' => action_logout(),
        'state' => action_state(),
        'claim' => action_claim(),
        'replace' => action_replace(),
        'release' => action_release(),
        'export_paid' => action_export_paid(),
        'me' => action_me(),
        'my_orders' => action_my_orders(),
        'my_order' => action_my_order(),
        'my_claimed' => action_my_claimed(),
        'my_paid' => action_my_paid(),
        'my_settlements' => action_my_settlements(),
        'wallet_save' => action_wallet_save(),
        'proof' => action_proof(),
        'settlement_add' => action_settlement_add(),
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
