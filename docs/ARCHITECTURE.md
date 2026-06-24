# Check CX 架构说明

本文档描述 Check CX 的整体架构、核心数据流以及模块边界，确保文档与当前实现一致。

## 1. 总览

Check CX 由两部分组成（两项目已合并）：

1. **Next.js 单体应用**：统一提供公共 Dashboard（`/`）、管理后台（`/admin/*`）、页面与 API 路由。
2. **本地 SQLite 数据层与内置轮询器**：使用 better-sqlite3 存储配置、历史、统计；轮询器作为单进程内置服务自启动。

核心数据流：

```
check_request_templates + check_models + check_configs → 内置轮询器 → check_history → 聚合快照 → API / 页面渲染
```

## 2. 运行时组件

- **页面与 API**
  - `app/page.tsx`：SSR 首屏数据（`loadDashboardData(refreshMode="missing")`）。
  - `app/group/[groupName]/page.tsx`：分组详情页。
  - `app/api/dashboard/route.ts`：Dashboard 数据 API（ETag + CDN 缓存）。
  - `app/api/group/[groupName]/route.ts`：分组数据 API。
  - `app/api/v1/status/route.ts`：对外只读状态 API。

- **管理后台**
  - `app/admin/*`：管理界面（`middleware.ts` 通过 `ADMIN_LOGIN_KEY` + HMAC cookie 验证）。

- **内置轮询器**
  - `lib/core/poller.ts`：定时执行检查与写入。
  - `instrumentation.ts`：启动时自动运行 `runMigrations()` 并启动轮询器。
  - `lib/core/official-status-poller.ts`：轮询官方状态并缓存。

- **SQLite 数据层**
  - `lib/db/client.ts`：单例连接（WAL 模式、外键启用、繁忙超时）。
  - `lib/db/schema.sql`：权威数据模型（6 表）。
  - `lib/db/migrate.ts`：幂等迁移，启动时自动执行。
  - 表：`check_models`、`check_configs`、`check_request_templates`、`check_history`、`group_info`、`system_notifications`。
  - 数据访问模块：`history.ts`、`availability.ts`、`configs.ts`、`models.ts`、`templates.ts`、`groups.ts`、`notifications.ts`、`json.ts`。

## 3. 关键数据流

1. **配置加载**
   - `lib/database/config-loader.ts` 读取 `check_configs`（仅 `enabled = true`），并关联 `check_models` 与 `check_request_templates`。

2. **健康检查执行**
   - `lib/providers/ai-sdk-check.ts` 使用 Vercel AI SDK 调用模型。
   - 通过数学挑战验证响应，测量首 token 延迟。
   - `endpoint-ping.ts` 计算 Origin Ping 延迟。

3. **历史写入与裁剪**
   - `lib/database/history.ts` 负责写入 `check_history`。
   - 历史裁剪在应用层执行（基于 `HISTORY_RETENTION_DAYS` 环境变量）。

4. **可用性统计**
   - `lib/database/availability.ts` 使用 SQL 窗口函数计算 7/15/30 天可用性统计。
   - 类型验证在应用层执行（替代 Postgres 触发器）。

5. **快照与聚合**
   - `lib/core/health-snapshot-service.ts` 统一读取历史与触发刷新。
   - `lib/core/dashboard-data.ts`/`group-data.ts` 负责统计数据；Dashboard 分组逻辑已前移到客户端。返回完整时间线与可用性统计。

6. **对外输出**
   - Dashboard 页面与 API 均使用聚合数据结构（时间线、可用性统计）。

## 4. 模块边界

- `lib/core/`
  - 轮询器、聚合与缓存、轮询配置解析。
- `lib/providers/`
  - `ai-sdk-check.ts`：统一的 Provider 检查入口。
  - `challenge.ts`：数学挑战验证。
  - `endpoint-ping.ts`：网络层 Ping。
- `lib/official-status/`
  - OpenAI / Anthropic 官方状态抓取与解析。
- `lib/db/`
  - SQLite 连接单例、schema、迁移、幂等初始化。
- `lib/database/`
  - 配置加载、历史读写、可用性统计、通知与分组信息。
- `lib/admin/`
  - 管理后台业务逻辑（与 `lib/database/*` 共享 SQLite 数据层）。
- `components/`
  - Dashboard 与分组 UI、时间线、通知横幅等。

## 5. 数据模型与关系

- `check_configs` → `check_history`（`config_id` 外键）
- `check_models` → `check_configs`（`model_id` 外键）
- `check_request_templates` → `check_configs`（`template_id` 可选外键）
- `check_configs.group_name` ↔ `group_info.group_name`（分组元数据）
- `system_notifications` 为前端横幅提供公告

所有表通过 `lib/db/schema.sql` 定义，迁移通过 `lib/db/migrate.ts` 自动执行。

## 6. 缓存与一致性策略

- **后端快照缓存**：`global-state.ts` 保存最近一次读取的历史快照与刷新时间。
- **前端缓存**：`frontend-cache.ts` 实现 SWR 风格缓存，并配合 `ETag`。
- **官方状态缓存**：`official-status-poller.ts` 使用内存 `Map` 缓存结果。
- **SQLite 事务**：所有写入通过事务保证原子性；`lib/db/client.ts` 启用外键约束与繁忙超时处理并发。

## 7. 轮询器启动与生命周期

- 轮询器作为单进程内置服务，在 `instrumentation.ts` 中启动时自动初始化。
- `runMigrations()` 执行（幂等），确保 SQLite schema 最新。
- 轮询器单例通过 `import` 自动启动，无需多节点租约逻辑。
- 间隔由 `CHECK_POLL_INTERVAL_SECONDS` 环境变量控制。

## 8. 关键约束与环境变量

- `enabled = false` 的配置不会被轮询器读取。
- `check_configs.model_id` 关联的模型类型必须与 `check_configs.type` 一致。
- `is_maintenance = true` 会保留卡片并返回 `maintenance` 状态，但不执行实际检查。
- 运行时请求参数按 `template < model < config` 合并。

**环境变量**：
- `SQLITE_DB_PATH`：SQLite 数据库文件路径。
- `ADMIN_LOGIN_KEY`：管理后台登录密钥。
- `ADMIN_SESSION_SECRET`：管理 session HMAC 签名密钥。
- `APP_URL`：应用公共 URL。
- `CHECK_POLL_INTERVAL_SECONDS`：轮询间隔（秒）。
- `HISTORY_RETENTION_DAYS`：历史数据保留天数。
