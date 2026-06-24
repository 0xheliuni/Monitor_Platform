# Check CX 运维手册

本文面向运维与平台工程，描述部署、数据库初始化与日常运行维护要点。

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10
- SQLite（better-sqlite3，本地文件数据库）

## 2. 环境变量

### 必需（服务端）

- `SQLITE_DB_PATH`：SQLite 数据库文件路径（默认 `./data/monitor.db`）
- `ADMIN_LOGIN_KEY`：管理后台登录密钥
- `ADMIN_SESSION_SECRET`：管理后台会话签名密钥

### 可选（运行参数）

- `APP_URL`：应用公开访问地址
- `CHECK_POLL_INTERVAL_SECONDS`：检测间隔（15–600 秒）
- `CHECK_CONCURRENCY`：并发数（1–20）
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`：官方状态轮询间隔（60–3600 秒）
- `HISTORY_RETENTION_DAYS`：历史保留天数（7–365）

> 迁移说明：旧版数据库相关环境变量及节点标识变量已全部移除，如旧配置中存在请直接删除。

## 3. 数据库初始化

### 3.1 自动建表

应用启动时自动执行 `lib/db/schema.sql` 中的 `runMigrations()`，幂等建表，无需手动初始化。数据库文件及 WAL 文件（`monitor.db`、`monitor.db-wal`、`monitor.db-shm`）均位于 `SQLITE_DB_PATH` 所指目录（默认 `./data/`）。

首次启动流程：

1. 确认 `./data/` 目录存在且可写（Docker 部署见第 4 节）
2. 启动服务，`runMigrations()` 自动创建所有表与索引
3. 通过管理后台（`/admin/login`）添加第一条检测配置

### 3.2 检查数据库结构

使用 `sqlite3` CLI 或任意 SQLite 客户端直接查看：

```bash
sqlite3 ./data/monitor.db ".tables"
sqlite3 ./data/monitor.db ".schema check_configs"
```

### 3.2.1 模型拆分迁移后的自检 SQL

执行完模型拆分迁移后，建议至少跑下面几条检查：

```sql
-- 1) 当前模型总数
SELECT COUNT(*) AS model_count
FROM check_models;

-- 2) 是否存在未关联模型的配置（正常应为 0）
SELECT COUNT(*) AS configs_without_model
FROM check_configs
WHERE model_id IS NULL;

-- 3) 是否存在失效的 model_id（正常应为 0）
SELECT COUNT(*) AS orphan_model_refs
FROM check_configs c
LEFT JOIN check_models m ON m.id = c.model_id
WHERE m.id IS NULL;

-- 4) 配置类型和模型类型是否不一致（正常应为 0）
SELECT COUNT(*) AS type_mismatch_count
FROM check_configs c
JOIN check_models m ON m.id = c.model_id
WHERE c.type <> m.type;

-- 5) 相同 (type, model) 是否被错误拆成多条模型（正常应为空）
SELECT type, model, COUNT(*) AS duplicated_count
FROM check_models
GROUP BY type, model
HAVING COUNT(*) > 1;

-- 6) 抽样查看回填结果
SELECT
  c.name,
  c.type AS config_type,
  m.model,
  m.type AS model_type,
  c.endpoint,
  c.enabled,
  c.is_maintenance
FROM check_configs c
JOIN check_models m ON m.id = c.model_id
ORDER BY c.updated_at DESC
LIMIT 20;
```

如果你的数据库是从旧结构升级上来的，还可以补一条结构确认：

```sql
-- 7) 确认 check_configs 已不再保留旧 model 列
SELECT name FROM pragma_table_info('check_configs') WHERE name = 'model';
```

返回 0 行表示旧列已移除，结构已切换完成。

### 3.2.2 迁移失败时的排查与重跑

如果模型拆分迁移没有完全成功，先不要手动改业务代码，按下面顺序处理：

#### 场景 A：`check_models` 已创建，但 `check_configs.model_id` 没有全部回填

先检查哪些配置没有关联模型：

```sql
SELECT id, name, type, endpoint
FROM check_configs
WHERE model_id IS NULL
ORDER BY updated_at DESC;
```

然后安全重跑"模型去重插入 + model_id 回填"：

如果旧库已经完成迁移、`check_configs.model` 已删除，就不要尝试"自动重新生成模型名"。  
这时应优先从以下来源恢复模型定义：

- 数据库备份
- 迁移前快照
- 管理后台中人工确认过的模型清单
- 外部配置登记表

确认模型定义后，再补齐 `check_models`，最后回填 `model_id`。

对于仍保留旧 `check_configs.model` 列、但回填没完成的中间态，可执行：

```sql
INSERT INTO check_models (type, model)
SELECT DISTINCT type, model
FROM check_configs
WHERE model IS NOT NULL
ON CONFLICT (type, model) DO NOTHING;

UPDATE check_configs
SET model_id = (
  SELECT m.id FROM check_models m
  WHERE m.type = check_configs.type
    AND m.model = check_configs.model
)
WHERE model_id IS NULL;
```

#### 场景 B：模型表已经有数据，但出现重复模型

先找重复：

```sql
SELECT type, model, COUNT(*) AS duplicated_count
FROM check_models
GROUP BY type, model
HAVING COUNT(*) > 1;
```

如果真的出现重复，不要直接删。先确定保留哪条，再把 `check_configs.model_id` 指过去，最后删多余记录：

```sql
-- 示例：先人工选定 keep_id 和 drop_id
UPDATE check_configs
SET model_id = 'KEEP_MODEL_UUID'
WHERE model_id = 'DROP_MODEL_UUID';

DELETE FROM check_models
WHERE id = 'DROP_MODEL_UUID';
```

#### 场景 C：配置类型与模型类型不一致

先找出异常记录：

```sql
SELECT
  c.id AS config_id,
  c.name,
  c.type AS config_type,
  m.id AS model_id,
  m.type AS model_type,
  m.model
FROM check_configs c
JOIN check_models m ON m.id = c.model_id
WHERE c.type <> m.type;
```

处理原则：

- 配置类型填错：修 `check_configs.type`
- 模型挂错：把 `check_configs.model_id` 改到正确模型
- 两边都不确定：先停用该配置，再人工核对

#### 场景 D：需要重跑迁移 SQL

推荐做法：

1. 先执行上面的自检 SQL，确认当前卡在哪一步
2. 只重跑"幂等"的补齐语句：`CREATE TABLE IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`、`ON CONFLICT DO NOTHING`
3. 不要直接手改已上线业务代码来绕过数据问题
4. 重跑后再次执行"3.2.1 模型拆分迁移后的自检 SQL"

#### 场景 E：必须回滚

如果迁移刚执行完且业务还没切到新代码，优先从数据库备份（`./data/` 目录副本）恢复。  
如果新代码已经上线，不建议直接回滚到旧结构，因为代码已经按 `model_id` / `check_models` 工作。

更稳妥的做法是：

1. 维持当前表结构
2. 修复 `check_models` 和 `check_configs.model_id`
3. 通过自检 SQL 确认一致性
4. 再恢复流量或重新启用配置

### 3.3 关键对象

- 表：`check_models`、`check_configs`、`check_request_templates`、`check_history`、`group_info`、`system_notifications`
- 视图：`availability_stats`（如已在 schema.sql 中定义）
- 历史清理：启动后自动按 `HISTORY_RETENTION_DAYS` 修剪，也可通过管理后台手动触发

## 4. 部署模式

### 4.1 单进程部署（唯一支持的模式）

本应用为单进程架构，轮询器作为进程内单例运行。**不支持横向扩展**：同一 SQLite 数据库文件同时只能有一个运行实例，多实例并发写入会导致数据损坏。

如需高可用，建议在容器编排层面保证"单副本 + 自动重启"策略，而非运行多个实例。

### 4.2 Docker 部署

`Dockerfile` 在构建时安装 python3/make/g++ 以编译 better-sqlite3 原生模块；standalone 镜像内含 `schema.sql` 与原生模块。

`docker-compose.yml` 示例关键片段：

```yaml
services:
  monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data   # 持久化 SQLite 数据库文件
    environment:
      SQLITE_DB_PATH: /app/data/monitor.db
      ADMIN_LOGIN_KEY: your-secret-key
      ADMIN_SESSION_SECRET: your-session-secret
```

`./data` 目录挂载为可写卷，确保容器重建后数据不丢失。

## 5. 备份与恢复

### 5.1 备份

方式一：直接复制整个 `data/` 目录（需在服务停止时或 WAL 检查点后执行）：

```bash
cp -r ./data/ ./data_backup_$(date +%Y%m%d)/
```

方式二：使用 sqlite3 在线热备（服务运行中也可安全执行）：

```bash
sqlite3 ./data/monitor.db ".backup ./data_backup/monitor.db"
```

建议将备份纳入定时任务（cron），至少保留最近 7 天的副本。

### 5.2 恢复

停止服务，用备份文件替换 `SQLITE_DB_PATH` 指向的数据库文件（及同名 `-wal`/`-shm` 文件），再重启服务即可。

## 6. 运维操作

### 6.1 添加与调整配置

使用 `sqlite3` CLI 或管理后台（`/admin/*`）操作：

```sql
-- 先确保模型存在
INSERT INTO check_models (type, model)
VALUES ('openai', 'gpt-4o-mini')
ON CONFLICT (type, model) DO NOTHING;

-- 再新增配置实例
INSERT INTO check_configs (name, type, model_id, endpoint, api_key, enabled)
SELECT 'OpenAI GPT-4o',
       'openai',
       id,
       'https://api.openai.com/v1/chat/completions',
       'sk-xxx',
       true
FROM check_models
WHERE type = 'openai'
  AND model = 'gpt-4o-mini';

-- 维护模式
UPDATE check_configs SET is_maintenance = true WHERE name = 'OpenAI GPT-4o';

-- 禁用
UPDATE check_configs SET enabled = false WHERE name = 'OpenAI GPT-4o';
```

参数优先级固定为：

- `check_request_templates`：跨模型复用的通用默认值
- `check_models`：只负责绑定模型与模板
- `check_configs`：只负责实例连接信息

运行时只读取模型绑定模板中的 `request_header` / `metadata`

### 6.2 分组信息维护

```sql
INSERT INTO group_info (group_name, website_url, tags)
VALUES ('主力服务商', 'https://example.com', 'core,prod');
```

`tags` 为英文逗号分隔字符串，前端会解析展示。

### 6.3 系统通知

```sql
INSERT INTO system_notifications (message, level, is_active)
VALUES ('**注意**：部分服务延迟升高', 'warning', true);
```

### 6.4 历史保留

- 每次写入后自动按 `HISTORY_RETENTION_DAYS` 清理过期历史。
- 如需手动清理，可直接执行：

```sql
DELETE FROM check_history
WHERE checked_at < datetime('now', '-30 days');
```

## 7. 监控与日志

关键日志（服务端）：

- `[check-cx] 初始化后台轮询器...`
- `[check-cx] 本轮检测明细：...`
- `[官方状态] openai: operational - ...`

建议按关键字 `check-cx` 与 `[官方状态]` 建立日志告警。

## 8. 路由说明

- 公开面板：`/`、`/group/*`、`/api/*`
- 管理后台：`/admin/*`（登录入口：`/admin/login`，需 `ADMIN_LOGIN_KEY`）

## 9. 常见问题

### 9.1 页面没有任何卡片

- 确认 `check_configs` 至少一条 `enabled = true`。
- 确认对应 `model_id` 已正确关联到 `check_models`。
- 检查服务端是否报缺失环境变量或权限错误。

### 9.2 时间线一直为空

- 查看轮询器日志是否运行。
- 检查 `check_history` 是否有新增记录：`sqlite3 ./data/monitor.db "SELECT COUNT(*) FROM check_history;"`
- 确认 `CHECK_POLL_INTERVAL_SECONDS` 未设置过大。

### 9.3 官方状态显示 unknown

- 当前仅 OpenAI/Anthropic 实现官方状态。
- 检查外网访问是否被阻断或 DNS 被限制。

### 9.4 数据库锁定或写入失败

- 确认只有一个服务实例在运行（SQLite 不支持多进程并发写入）。
- 检查 `./data/` 目录权限，确保进程对数据库文件有读写权限。
- Docker 部署时确认 `./data:/app/data` 卷挂载正确且宿主目录可写。
- 如出现 `-wal` 文件残留导致打开失败，可在服务停止后执行：`sqlite3 ./data/monitor.db "PRAGMA wal_checkpoint(TRUNCATE);"`
