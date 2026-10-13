<?php
// 公共函数：配置、数据库、会话、JSON 输出、Stripe 状态查询
declare(strict_types=1);

date_default_timezone_set('Asia/Shanghai');

function config(): array
{
    static $config = null;
    if ($config === null) $config = require __DIR__ . '/config.php';
    return $config;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $pdo = new PDO(
            "mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4",
            $c['user'],
            $c['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        $pdo->exec("SET time_zone = '+08:00'");
    }
    return $pdo;
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function json_out(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * 出错返回。code 是给网页翻译用的错误码（中 / 英 / 乌兹别克语），error 是中文原文，
 * 桌面端与日志直接看 error。
 */
function fail(string $message, int $status = 400, string $code = ''): never
{
    json_out(['ok' => false, 'error' => $message, 'code' => $code], $status);
}

/** 请求体 JSON */
function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function client_ip(): string
{
    // 经 Cloudflare 转发，真实 IP 在 CF-Connecting-IP
    return $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
}

// ============ 会话（客户登录） ============

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('PLSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

/**
 * 当前登录的客户；没登录、账号被停用或删掉、密码被重置过（session_version 变了）都返回 null。
 * 每个请求都回库对一次，管理端改了账号立刻生效，不用等会话过期。
 */
function current_client(): ?array
{
    static $client = false;
    if ($client !== false) return $client;
    start_session();
    $id = (int) ($_SESSION['client_id'] ?? 0);
    $client = null;
    if ($id) {
        $stmt = db()->prepare('SELECT * FROM clients WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch() ?: null;
        if ($row && $row['enabled'] && (int) $row['session_version'] === (int) ($_SESSION['session_version'] ?? -1)) {
            $client = $row;
        }
    }
    return $client;
}

function logged_in(): bool
{
    return current_client() !== null;
}

/** 返回当前客户；未登录直接 401 */
function require_login(): array
{
    $client = current_client();
    if (!$client) fail('请先登录', 401, 'login_required');
    // 写操作校验 CSRF：页面加载时拿到 token，请求头带回来
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'] ?? '', $token)) fail('页面已过期，请刷新', 403, 'csrf');
    }
    return $client;
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

// ============ 桌面端同步认证 ============

function require_sync_token(): void
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = preg_match('/^Bearer\s+(.+)$/i', $header, $m) ? trim($m[1]) : '';
    $expected = (string) (config()['sync_token'] ?? '');
    if ($expected === '' || !hash_equals($expected, $token)) fail('同步密钥不正确', 401);
}

// ============ 领取超时 ============

/**
 * 领走超过时限还没付的放回。放回 = 标记 refresh，由桌面端换新链接再上架：
 * 旧链接可能还在工作人员手里，直接放回去会被第二个人拿到，两个人付同一条。
 */
function release_timeouts(): int
{
    // 每个客户可以单独设领取时限；没归属的（老数据）用 config 里的默认值
    $fallback = (int) (config()['claim_timeout_minutes'] ?? 180);
    $stmt = db()->prepare(
        "UPDATE links l LEFT JOIN clients c ON c.id = l.client_id
         SET l.status = 'refresh', l.refresh_reason = 'timeout', l.updated_at = ?
         WHERE l.status = 'claimed'
           AND l.claimed_at < DATE_SUB(?, INTERVAL COALESCE(c.claim_timeout_minutes, ?) MINUTE)"
    );
    $stmt->execute([now(), now(), $fallback]);
    return $stmt->rowCount();
}

// ============ Stripe ============

/** 从结算链接拆出会话 id 与 publishable key（片段是 URL 编码的 base64，逐字节异或 5 得到 JSON） */
function parse_checkout_url(string $url): ?array
{
    $parts = parse_url($url);
    if (!$parts || empty($parts['path']) || empty($parts['fragment'])) return null;
    if (!preg_match('/(cs_(?:live|test)_[A-Za-z0-9]+)/', $parts['path'], $m)) return null;
    $bytes = base64_decode(rawurldecode($parts['fragment']), true);
    if ($bytes === false) return null;
    $json = '';
    for ($i = 0, $n = strlen($bytes); $i < $n; $i++) $json .= chr(ord($bytes[$i]) ^ 5);
    if (!preg_match('/"apiKey"\s*:\s*"(pk_(?:live|test)_[^"]+)"/', $json, $k)) return null;
    return ['session' => $m[1], 'key' => $k[1]];
}

/**
 * 并发查一批结算会话的状态。返回 url_hash => open | complete | expired | inactive | error。
 *
 * 实测：未付款 200 status=open；付完或失效都是 400「This Checkout Session is no longer active.」，
 * 分不出来，记 inactive，由桌面端查 Kiro 档位定性。
 */
function stripe_statuses(array $rows, int $concurrency = 8): array
{
    $result = [];
    foreach (array_chunk($rows, $concurrency) as $chunk) {
        $multi = curl_multi_init();
        $handles = [];
        foreach ($chunk as $row) {
            $parsed = parse_checkout_url($row['url']);
            if (!$parsed) {
                $result[$row['url_hash']] = 'error';
                continue;
            }
            $ch = curl_init("https://api.stripe.com/v1/payment_pages/{$parsed['session']}/init");
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => http_build_query([
                    'key' => $parsed['key'],
                    'eid' => 'NA',
                    'browser_locale' => 'en-US',
                    'redirect_type' => 'url',
                ]),
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                    'Content-Type: application/x-www-form-urlencoded',
                    'Origin: https://checkout.stripe.com',
                    'Referer: https://checkout.stripe.com/',
                ],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 20,
            ]);
            curl_multi_add_handle($multi, $ch);
            $handles[$row['url_hash']] = $ch;
        }
        do {
            $status = curl_multi_exec($multi, $running);
            if ($running) curl_multi_select($multi, 1.0);
        } while ($running && $status === CURLM_OK);

        foreach ($handles as $hash => $ch) {
            $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $data = json_decode((string) curl_multi_getcontent($ch), true) ?: [];
            $message = (string) ($data['error']['message'] ?? '');
            if ($code === 200) {
                $s = strtolower((string) ($data['status'] ?? ''));
                $p = strtolower((string) ($data['payment_status'] ?? ''));
                $result[$hash] = ($s === 'complete' || $p === 'paid') ? 'complete' : ($s === 'expired' ? 'expired' : 'open');
            } elseif ($code === 400 && stripos($message, 'expired') !== false) {
                $result[$hash] = 'expired';
            } elseif ($code === 400 && preg_match('/no longer active|not active|inactive/i', $message)) {
                $result[$hash] = 'inactive';
            } else {
                $result[$hash] = 'error';
            }
            curl_multi_remove_handle($multi, $ch);
            curl_close($ch);
        }
        curl_multi_close($multi);
    }
    return $result;
}

/** 按 Stripe 结果改链接状态；已付款 / 已替换的不再动 */
function apply_stripe_statuses(array $statuses): array
{
    $count = ['paid' => 0, 'checking' => 0, 'refresh' => 0];
    $pdo = db();
    $find = $pdo->prepare('SELECT id, status FROM links WHERE url_hash = ?');
    $touch = $pdo->prepare('UPDATE links SET stripe_status = ?, stripe_checked_at = ? WHERE id = ?');
    $set = $pdo->prepare(
        'UPDATE links SET status = ?, stripe_status = ?, stripe_checked_at = ?, updated_at = ?,
           paid_at = IF(? = \'paid\', COALESCE(paid_at, ?), paid_at),
           refresh_reason = IF(? = \'refresh\', \'expired\', refresh_reason)
         WHERE id = ?'
    );
    foreach ($statuses as $hash => $stripe) {
        if ($stripe === 'error') continue;
        $find->execute([$hash]);
        $row = $find->fetch();
        if (!$row || in_array($row['status'], ['paid', 'superseded'], true)) continue;
        $next = match ($stripe) {
            'complete' => 'paid',
            'expired' => 'refresh',
            // 领走的不能再付了：多半是付了，等桌面端确认；没领过的不能再付只能是失效
            'inactive' => $row['status'] === 'claimed' ? 'checking' : 'refresh',
            default => null,
        };
        if ($next === null || $next === $row['status']) {
            $touch->execute([$stripe, now(), $row['id']]);
            continue;
        }
        $t = now();
        $set->execute([$next, $stripe, $t, $t, $next, $t, $next, $row['id']]);
        $count[$next]++;
    }
    return $count;
}

// ============ 订单批次 ============

/** 付款数达到订单数的批次标记完成；任何改动链接状态的地方之后都调一次 */
function close_done_orders(): int
{
    $stmt = db()->prepare(
        "UPDATE orders o SET o.status = 'done', o.done_at = ?, o.updated_at = ?
         WHERE o.status = 'open'
           AND (SELECT COUNT(*) FROM links l WHERE l.order_id = o.id AND l.status = 'paid') >= o.quantity"
    );
    $stmt->execute([now(), now()]);
    return $stmt->rowCount();
}

/**
 * 限速：同一客户 3 秒内只能领 / 换一次。原子更新，两个页面同时点也只放过一个。
 * 防的是客户乱点、连点把链接一下领空。
 */
function throttle_client(int $clientId, float $seconds = 3.0): void
{
    $stmt = db()->prepare(
        "UPDATE clients SET last_action_at = NOW(3)
         WHERE id = ? AND (last_action_at IS NULL OR last_action_at < DATE_SUB(NOW(3), INTERVAL ? MICROSECOND))"
    );
    $stmt->execute([$clientId, (int) ($seconds * 1000000)]);
    if (!$stmt->rowCount()) fail('操作太快了，请稍等几秒再试', 429, 'too_fast');
}

/** 一个批次的统计：已领待付、已付、还能领多少 */
function order_stats(int $orderId): array
{
    $row = db()->query(
        "SELECT o.*,
                (SELECT COUNT(*) FROM links l WHERE l.order_id = o.id AND l.status = 'paid') AS paid,
                (SELECT COUNT(*) FROM links l WHERE l.order_id = o.id AND l.status IN ('claimed', 'checking')) AS holding
         FROM orders o WHERE o.id = $orderId"
    )->fetch();
    if (!$row) return [];
    $row['remaining'] = max(0, (int) $row['quantity'] - (int) $row['paid'] - (int) $row['holding']);
    return $row;
}
