<?php
// 配置模板：部署时复制成 config.php 并填好。config.php 不进仓库。
return [
    'db' => [
        'host' => '127.0.0.1',
        'name' => 'paylinks',
        'user' => 'paylinks',
        'pass' => '',
    ],
    // 客户登录账号；password_hash 用 password_hash('明文', PASSWORD_DEFAULT) 生成
    'client' => [
        'username' => 'client',
        'password_hash' => '',
    ],
    // 网页管理后台（manage.php）的管理员账号；不填就进不了网页后台，桌面端照常用同步密钥管理
    'admin' => [
        'username' => 'admin',
        'password_hash' => '',
    ],
    // 桌面端同步用的密钥（与客户密码无关），桌面端设置里填同一个值
    'sync_token' => '',
    // 领走多少分钟未付款就作废换新（默认 24 小时；只管网站上领的，线下发出的批次不自动动）
    'claim_timeout_minutes' => 1440,
    // 单次最多领取条数
    'max_claim' => 50,
];
