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

/** 登记一个回调：本次请求成功输出（ok=true）前执行，用于只给成功的操作留痕 */
function on_json_ok(?callable $fn = null): ?callable
{
    static $hook = null;
    if (func_num_args()) $hook = $fn;
    return $hook;
}

function json_out(array $data, int $status = 200): never
{
    if (!empty($data['ok']) && ($hook = on_json_ok())) {
        on_json_ok(null);
        try {
            $hook($data);
        } catch (Throwable) {
            // 记日志失败不影响操作本身
        }
    }
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
    // 宝塔 nginx 全局开了 fastcgi_intercept_errors，404 会被换成 HTML 错误页，错误文案就丢了
    if ($status === 404) $status = 400;
    json_out(['ok' => false, 'error' => $message, 'code' => $code], $status);
}

/** 请求体 JSON */
function body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Cloudflare 回源 IP 段（https://www.cloudflare.com/ips/，2026-10 取） */
const CLOUDFLARE_RANGES = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
    '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
    '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
    '2a06:98c0::/29', '2c0f:f248::/32',
];

function ip_in_cidr(string $ip, string $cidr): bool
{
    [$net, $bits] = explode('/', $cidr);
    $a = @inet_pton($ip);
    $b = @inet_pton($net);
    if ($a === false || $b === false || strlen($a) !== strlen($b)) return false;
    $bits = (int) $bits;
    $bytes = intdiv($bits, 8);
    if (substr($a, 0, $bytes) !== substr($b, 0, $bytes)) return false;
    $rest = $bits % 8;
    if (!$rest) return true;
    $mask = chr((0xff << (8 - $rest)) & 0xff);
    return (($a[$bytes] & $mask) === ($b[$bytes] & $mask));
}

/**
 * 访客真实 IP。源站也能被直连，CF-Connecting-IP 只有请求确实来自 Cloudflare 时才信，
 * 否则谁都能伪造这个头换 IP 绕过登录限流。
 */
function client_ip(): string
{
    $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $cf = (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? '');
    if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) {
        foreach (CLOUDFLARE_RANGES as $range) {
            if (ip_in_cidr($remote, $range)) return $cf;
        }
    }
    return $remote;
}

// ============ 键值记录 / 管理日志 ============

function meta_get(string $key): ?array
{
    $stmt = db()->prepare('SELECT v FROM meta WHERE k = ?');
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : (json_decode((string) $v, true) ?: null);
}

function meta_set(string $key, array $value): void
{
    db()->prepare('INSERT INTO meta (k, v, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)')
        ->execute([$key, json_encode($value, JSON_UNESCAPED_UNICODE), now()]);
}

/** 管理操作留痕：谁（网页管理员 / 桌面端）、什么时候、从哪个 IP、做了什么 */
function admin_log(string $op, array $detail = []): void
{
    unset($detail['password']);
    $actor = !empty($_SERVER['HTTP_AUTHORIZATION']) ? 'desktop' : (string) ($_SESSION['admin'] ?? 'admin');
    db()->prepare('INSERT INTO admin_log (at, actor, ip, op, detail) VALUES (?, ?, ?, ?, ?)')
        ->execute([now(), substr($actor, 0, 32), substr(client_ip(), 0, 64), $op, mb_substr(json_encode($detail, JSON_UNESCAPED_UNICODE), 0, 1000)]);
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
    // 线下批次的链接都是发好的，不能再从池子领
    $row['remaining'] = $row['source'] === 'offline' ? 0 : max(0, (int) $row['quantity'] - (int) $row['paid'] - (int) $row['holding']);
    return $row;
}

// ============ 管理员（网页后台） ============

/** 管理员网页会话：与客户会话分开存，config.php 里的 admin 账号登录 */
function admin_session_ok(): bool
{
    start_session();
    $admin = config()['admin'] ?? null;
    return $admin && !empty($_SESSION['admin'])
        && hash_equals((string) $admin['username'], (string) $_SESSION['admin']);
}

/**
 * 管理接口的认证：桌面端带同步密钥（Bearer），网页后台带管理员会话 + CSRF。
 * 两条路给的权限一样。
 */
function require_admin(): void
{
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        require_sync_token();
        return;
    }
    if (!admin_session_ok()) fail('请先登录管理后台', 401, 'login_required');
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!hash_equals($_SESSION['admin_csrf'] ?? '', $token)) fail('页面已过期，请刷新', 403, 'csrf');
}

// ============ 分页 ============

/** 分页参数：page 从 1 开始，page_size 限制在 [min, max]；返回 [page, size, offset] */
function page_args(array $in, int $default = 20, int $max = 200): array
{
    $page = max(1, (int) ($in['page'] ?? 1));
    $size = max(5, min($max, (int) ($in['page_size'] ?? $default)));
    return [$page, $size, ($page - 1) * $size];
}

// ============ 结算：网络 / 地址 / 凭证 ============

/**
 * 支持的收款网络。默认 Polygon（手续费低，日常都走这条）。
 * address / tx：地址与交易哈希的格式；explorer：区块浏览器上查交易的地址前缀。
 */
const NETWORKS = [
    'polygon' => ['name' => 'Polygon', 'address' => '/^0x[0-9a-fA-F]{40}$/', 'tx' => '/^0x[0-9a-fA-F]{64}$/', 'explorer' => 'https://polygonscan.com/tx/'],
    'ethereum' => ['name' => 'Ethereum', 'address' => '/^0x[0-9a-fA-F]{40}$/', 'tx' => '/^0x[0-9a-fA-F]{64}$/', 'explorer' => 'https://etherscan.io/tx/'],
    'bsc' => ['name' => 'BNB Chain', 'address' => '/^0x[0-9a-fA-F]{40}$/', 'tx' => '/^0x[0-9a-fA-F]{64}$/', 'explorer' => 'https://bscscan.com/tx/'],
    'arbitrum' => ['name' => 'Arbitrum', 'address' => '/^0x[0-9a-fA-F]{40}$/', 'tx' => '/^0x[0-9a-fA-F]{64}$/', 'explorer' => 'https://arbiscan.io/tx/'],
    'tron' => ['name' => 'Tron', 'address' => '/^T[1-9A-HJ-NP-Za-km-z]{33}$/', 'tx' => '/^[0-9a-fA-F]{64}$/', 'explorer' => 'https://tronscan.org/#/transaction/'],
];
const TOKENS = ['USDT', 'USDC'];
/**
 * 现在开放的收款网络：只有 Polygon。NETWORKS 里其他的留着，只用来显示历史记录（名称、浏览器链接），
 * 新填地址 / 记打款都只能选这里的。
 */
const ENABLED_NETWORKS = ['polygon'];

function network_enabled(string $n): bool
{
    return in_array($n, ENABLED_NETWORKS, true);
}

function network_or_default(string $n): string
{
    return isset(NETWORKS[$n]) ? $n : 'polygon';
}

function valid_address(string $network, string $address): bool
{
    return isset(NETWORKS[$network]) && preg_match(NETWORKS[$network]['address'], $address) === 1;
}

function valid_tx_hash(string $network, string $hash): bool
{
    return isset(NETWORKS[$network]) && preg_match(NETWORKS[$network]['tx'], $hash) === 1;
}

/** 前端用：可选的网络（名称、浏览器前缀），不带正则 */
function networks_public(): array
{
    $out = [];
    foreach (ENABLED_NETWORKS as $k) $out[] = ['id' => $k, 'name' => NETWORKS[$k]['name'], 'explorer' => NETWORKS[$k]['explorer']];
    return $out;
}

function proofs_dir(): string
{
    return __DIR__ . '/proofs';
}

/**
 * 存一张付款凭证。只收 jpg / png / webp / pdf，5 MB 以内；图片用 GD 重新编码一遍（去掉 EXIF 与夹带的数据），
 * 文件名随机，放在 /inc/ 下（nginx 禁止直接访问），只能经 api.php?action=proof 带登录读。
 * @return array{0:string,1:string} [文件名, MIME]
 */
function store_proof(array $file): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string) $file['tmp_name'])) fail('凭证上传失败');
    if ((int) $file['size'] > 5 * 1024 * 1024) fail('凭证不能超过 5 MB');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']) ?: '';
    $exts = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
    if (!isset($exts[$mime])) fail('凭证只支持 JPG / PNG / WEBP 图片或 PDF');
    $name = bin2hex(random_bytes(16)) . '.' . $exts[$mime];
    $dest = proofs_dir() . '/' . $name;
    if ($mime === 'application/pdf') {
        if (!move_uploaded_file((string) $file['tmp_name'], $dest)) fail('凭证保存失败');
    } else {
        $img = @imagecreatefromstring((string) file_get_contents((string) $file['tmp_name']));
        if (!$img) fail('图片读不出来，换一张试试');
        $ok = match ($mime) {
            'image/png' => imagepng($img, $dest, 6),
            'image/webp' => imagewebp($img, $dest, 85),
            default => imagejpeg($img, $dest, 88),
        };
        imagedestroy($img);
        if (!$ok) fail('凭证保存失败');
    }
    return [$name, $mime];
}

/** 输出凭证文件；调用方先做权限检查 */
function send_proof(string $name, string $mime): never
{
    $path = proofs_dir() . '/' . basename($name);
    if ($name === '' || !preg_match('/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/', $name) || !is_file($path)) fail('凭证不存在', 404);
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="proof-' . substr($name, 0, 8) . '.' . pathinfo($name, PATHINFO_EXTENSION) . '"');
    header('Cache-Control: private, max-age=3600');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    readfile($path);
    exit;
}

/** 批次应结金额 = 已付款链接的实付合计（USD）；按批次重算结算状态，管理员手动改过的以手动为准 */
function settle_status_for(float $due, float $settled): string
{
    if ($settled <= 0) return 'unsettled';
    return $settled + 0.005 >= $due ? 'settled' : 'partial';
}

// ============ 应结金额 ============
//
// 结算按实际付款的条数：批次设了单价（每条已付款结多少）就是 已付条数 × 单价；
// 没设单价按实付金额（每条 amount_due 合计）。没挂批次的已付款按实付金额算。

/** 一个批次的应结（SQL 片段，需要 orders 别名 o、links 别名 l 已 LEFT JOIN） */
const DUE_SQL = "IF(o.unit_price IS NULL, COALESCE(SUM(IF(l.status = 'paid', l.amount_due, 0)), 0), SUM(l.status = 'paid') * o.unit_price)";

function order_due(int $orderId): float
{
    return (float) db()->query(
        "SELECT " . DUE_SQL . " FROM orders o LEFT JOIN links l ON l.order_id = o.id WHERE o.id = $orderId GROUP BY o.id"
    )->fetchColumn();
}

/** 每个客户的应结合计：client_id → 金额 */
function client_due_map(?int $clientId = null): array
{
    $where = $clientId ? "WHERE o.client_id = $clientId" : '';
    $map = [];
    foreach (db()->query("SELECT o.client_id, " . DUE_SQL . " AS due FROM orders o LEFT JOIN links l ON l.order_id = o.id $where GROUP BY o.id") as $r) {
        $map[$r['client_id']] = ($map[$r['client_id']] ?? 0) + (float) $r['due'];
    }
    $where2 = $clientId ? "AND client_id = $clientId" : '';
    foreach (db()->query("SELECT client_id, SUM(amount_due) AS due FROM links WHERE status = 'paid' AND order_id IS NULL AND client_id IS NOT NULL $where2 GROUP BY client_id") as $r) {
        $map[$r['client_id']] = ($map[$r['client_id']] ?? 0) + (float) $r['due'];
    }
    return array_map(fn ($v) => round($v, 2), $map);
}

/** 单价：空串 / null = 按实付金额；否则 0 ~ 1000 */
function unit_price_or_null($v): ?float
{
    if ($v === null || $v === '' || !is_numeric($v)) return null;
    return round(max(0, min(1000, (float) $v)), 2);
}
