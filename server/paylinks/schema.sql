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
  KEY idx_paid (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 登录失败记录：同一 IP 15 分钟内失败 8 次就暂时拒绝
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip         VARCHAR(64) NOT NULL,
  at         DATETIME    NOT NULL,
  KEY idx_ip_at (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
