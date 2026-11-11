# 更新记录

## v1.0.0 · 2026-11-11

首个完整版本。

### 网站与交互

- 本地单页应用：实时车位地图、预约、停车计时、充电结算、账单导出。
- 车主工作台：本月充电量、消费、碳减排、近 7 日趋势、最近动态。
- 运营后台：在场车辆、车位维护、月度营收、区域占用率。

### 账户与安全

- 邮箱注册 / 登录 / 退出，PBKDF2-SHA256 加盐哈希，HttpOnly + SameSite=Strict Cookie。
- 会话令牌只保存 SHA-256 指纹，7 天过期；登录失败限速。
- 所有 SQL 使用参数化查询，接口做同源校验与输入校验。

### 数据库

- SQLite（WAL、外键、部分唯一索引），6 张表：`users`、`auth_sessions`、`vehicles`、`slots`、`reservations`、`parking_records`。
- 首次启动自动建表并写入演示数据；演示账号数据超过 40 小时无活动时自动按当前时间重建。
- 单笔订单最长 24 小时，超时订单启动时自动结算并释放车位。
- 提供 [数据库设计](docs/数据库设计.md) 与 [建表 SQL](docs/voltpark_schema.sql)。

### 工程

- 零第三方依赖：Python 标准库 + 原生 HTML/CSS/JS，断网可用。
- `启动VoltPark.bat` 一键启动并打开浏览器。
- `.gitignore` 排除本地数据库与缓存，`.gitattributes` 统一换行符。
