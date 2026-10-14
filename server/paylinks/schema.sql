-- 代付链接站：数据库结构
--
-- 一条记录 = 一个 Stripe 结算链接。状态流转：
--   available  可领取（客户看得到、能领）
--   claimed    已被客户领走，等付款
--   checking   Stripe 显示会话已不能再付，等桌面端用 Kiro 档位确认是付了还是失效
--   paid       已付款（结算按这个算）
--   refresh    需要换新链接：领走 3 小时未付自动放回、客户手动放回、链接失效、金额不是最优。
--              旧链接可能还在工作人员手里，直接放回会被两人重复付，所以一律由桌面端重新生成
--   superseded 已被新链接替换，只留作记录
-- 邮箱、凭证都不上服务器：account_ref 是桌面端账号 id 的哈希，只有桌面端能对回去。

CREATE TABLE IF NOT EXISTS clients (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(64)   NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  display_name    VARCHAR(64)   NOT NULL DEFAULT '',
  enabled         TINYINT(1)    NOT NULL DEFAULT 1,
  max_claim       INT UNSIGNED  NOT NULL DEFAULT 50,
  claim_timeout_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
  -- 改密码 / 停用 / 强制下线时加一，旧会话随之失效
  session_version INT UNSIGNED  NOT NULL DEFAULT 1,
  note            VARCHAR(255)  NOT NULL DEFAULT '',
  -- 收款地址：客户在门户里填（改要输密码）；默认 Polygon 上的 USDT
  wallet_network  VARCHAR(16)   NOT NULL DEFAULT 'polygon',
  wallet_token    VARCHAR(16)   NOT NULL DEFAULT 'USDT',
  wallet_address  VARCHAR(64)   NOT NULL DEFAULT '',
  wallet_updated_at DATETIME    NULL,
  -- 新批次默认的每条结算单价；空 = 按每条实付金额
  unit_price      DECIMAL(10,2) NULL,
  last_login_at   DATETIME      NULL,
  last_action_at  DATETIME(3)   NULL,
  created_at      DATETIME      NOT NULL,
  updated_at      DATETIME      NOT NULL,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS links (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  url_hash        CHAR(64)      NOT NULL,
  url             TEXT          NOT NULL,
  account_ref     CHAR(64)      NOT NULL,
  tier            VARCHAR(16)   NOT NULL,
  amount_due      DECIMAL(10,2) NULL,
  amount_cny      DECIMAL(10,2) NULL,
  list_price      DECIMAL(10,2) NULL,
  status          VARCHAR(16)   NOT NULL DEFAULT 'available',
  client_id       INT UNSIGNED  NULL,
  order_id        INT UNSIGNED  NULL,
  claimed_at      DATETIME      NULL,
  claim_batch     VARCHAR(32)   NULL,
  paid_at         DATETIME      NULL,
  refresh_reason  VARCHAR(32)   NULL,
  stripe_status   VARCHAR(16)   NULL,
  stripe_checked_at DATETIME    NULL,
  extracted_at    DATETIME      NOT NULL,
  created_at      DATETIME      NOT NULL,
  updated_at      DATETIME      NOT NULL,
  UNIQUE KEY uk_url_hash (url_hash),
  KEY idx_status (status, tier),
  KEY idx_account (account_ref),
  KEY idx_paid (paid_at),
  KEY idx_client (client_id, status),
  KEY idx_order (order_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 派单批次：给某个客户开「档位 × 数量」，客户在批次里领取、更换
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(32)   NOT NULL,
  client_id       INT UNSIGNED  NOT NULL,
  tier            VARCHAR(16)   NOT NULL,
  quantity        INT UNSIGNED  NOT NULL,
  replace_limit   INT UNSIGNED  NOT NULL DEFAULT 0,
  replaced        INT UNSIGNED  NOT NULL DEFAULT 0,
  status          VARCHAR(16)   NOT NULL DEFAULT 'open',
  -- site 网站派单（客户在网站上领）；offline 线下（TXT / Excel）发出后补建，链接早已在客户手里，不从池子领
  source          VARCHAR(16)   NOT NULL DEFAULT 'site',
  -- 结算：unsettled / partial / settled；已结金额（USD）。记打款时自动累加，管理员可手动改
  settle_status   VARCHAR(16)   NOT NULL DEFAULT 'unsettled',
  settled_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  settled_at      DATETIME      NULL,
  settle_note     VARCHAR(255)  NOT NULL DEFAULT '',
  -- 每条结算单价：应结 = 已付条数 × 单价；空 = 按每条实付金额合计
  unit_price      DECIMAL(10,2) NULL,
  note            VARCHAR(255)  NOT NULL DEFAULT '',
  created_at      DATETIME      NOT NULL,
  done_at         DATETIME      NULL,
  updated_at      DATETIME      NOT NULL,
  UNIQUE KEY uk_code (code),
  KEY idx_client_status (client_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 登录失败记录：同一 IP 15 分钟内失败太多次就暂时拒绝（客户登录 8 次，管理员登录 5 次，计数共用）
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip         VARCHAR(64) NOT NULL,
  at         DATETIME    NOT NULL,
  KEY idx_ip_at (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 杂项键值：desktop_sync = 桌面端最后一次同步的时间、版本、结果
CREATE TABLE IF NOT EXISTS meta (
  k          VARCHAR(64) NOT NULL PRIMARY KEY,
  v          TEXT        NOT NULL,
  updated_at DATETIME    NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 管理操作日志：网页后台与桌面端的改动都记（不含密码）
CREATE TABLE IF NOT EXISTS admin_log (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  at         DATETIME     NOT NULL,
  actor      VARCHAR(32)  NOT NULL,
  ip         VARCHAR(64)  NOT NULL,
  op         VARCHAR(32)  NOT NULL,
  detail     TEXT         NOT NULL,
  KEY idx_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 结算记录：给客户打的每一笔款（虚拟币）。to_address 是打款时收款地址的快照；凭证文件在 inc/proofs/
CREATE TABLE IF NOT EXISTS settlements (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED  NOT NULL,
  order_id    INT UNSIGNED  NULL,
  amount      DECIMAL(12,2) NOT NULL,
  token       VARCHAR(16)   NOT NULL DEFAULT 'USDT',
  network     VARCHAR(16)   NOT NULL DEFAULT 'polygon',
  to_address  VARCHAR(64)   NOT NULL DEFAULT '',
  tx_hash     VARCHAR(100)  NOT NULL DEFAULT '',
  proof_file  VARCHAR(80)   NOT NULL DEFAULT '',
  proof_mime  VARCHAR(40)   NOT NULL DEFAULT '',
  note        VARCHAR(255)  NOT NULL DEFAULT '',
  created_by  VARCHAR(32)   NOT NULL DEFAULT '',
  paid_at     DATETIME      NOT NULL,
  created_at  DATETIME      NOT NULL,
  KEY idx_client (client_id, paid_at),
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
