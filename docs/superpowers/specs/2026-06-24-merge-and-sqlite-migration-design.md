# Check CX 合并与 SQLite 改造方案

- 日期：2026-06-24
- 状态：已通过设计评审，待编写实施计划
- 作者：Claude (Superpowers Brainstorming)

## 1. 背景与目标

当前有两个独立的 Next.js 16 项目，共用同一套 Supabase（Postgres）数据库：

- **check-cx**（`v1.22.2`）：公开 AI 模型健康监控面板 + 后台轮询器。用 Supabase anon client 做只读、service-role admin client 做轮询写入。持有数据库的权威 schema（`supabase/schema.sql`）、RPC 函数与视图。
- **check-cx-admin**（`v0.2.6`）：管理后台（配置 / 模型 / 模板 / 分组 / 通知 / 用户）。全程用 service-role client，自带 cookie 口令登录（不依赖 Supabase Auth）。

**目标**：

1. 把两个项目合并为**单一 Next.js 16 应用**（公开面板 + 管理后台同进程）。
2. 把数据库从 **Supabase（Postgres）迁移到 SQLite**（`better-sqlite3`）。
3. 删除对 `@supabase/*` 的全部依赖与 RLS 机制。

**非目标（YAGNI）**：

- 不保留 Supabase 数据（全新开始，schema 平移，配置经后台重新录入）。
- 不改变认证语义（公开只读无认证；后台沿用口令 + HMAC cookie）。
- 不引入 ORM（保留现有"手写查询 + 显式类型"风格）。
- 不支持水平扩展（单进程单 SQLite 文件，删除多节点租约）。

## 2. 决策摘要（已确认）

| # | 决策点 | 选择 |
|---|---|---|
| 1 | 合并形态 | 单一 Next.js 应用（公开 `/`，后台 `/admin/*`） |
| 2 | 数据访问 | `better-sqlite3` + 手写薄封装数据层 |
| 3 | 认证模型 | 公开只读无认证；后台沿用 `ADMIN_LOGIN_KEY` + `ADMIN_SESSION_SECRET`；丢弃 RLS |
| 4 | 轮询器 | 删除多节点租约，改进程内单例守卫 |
| 5 | 数据 | 全新开始（schema 平移，不迁移旧数据） |

## 3. 目标目录结构

合并后为单一 Next.js 16 应用：

```
Monitor_Platform/
├── app/
│   ├── (public)/                    # 公开监控面板（原 check-cx）
│   │   ├── page.tsx                 # 首页 /
│   │   ├── group/[groupName]/page.tsx
│   │   └── layout.tsx
│   ├── admin/                       # 管理后台（原 check-cx-admin 的 dashboard）
│   │   ├── configs/ models/ templates/ groups/ notifications/ users/ system/
│   │   ├── login/page.tsx           # /admin/login
│   │   └── layout.tsx
│   ├── api/
│   │   ├── dashboard/route.ts       # 公开只读
│   │   ├── group/[groupName]/route.ts
│   │   ├── v1/status/route.ts
│   │   ├── notifications/route.ts
│   │   └── internal/cache-metrics/route.ts
│   ├── auth/                        # 后台登录/登出 route（原 admin）
│   │   ├── sign-in/password/route.ts
│   │   └── sign-out/route.ts
│   └── layout.tsx                   # 根布局
├── lib/
│   ├── db/                          # 【新】SQLite 数据访问层（替代所有 supabase）
│   │   ├── client.ts                # better-sqlite3 单例连接 + PRAGMA
│   │   ├── schema.sql               # SQLite 建表脚本（从 Postgres 平移）
│   │   ├── migrate.ts               # 启动时幂等建表
│   │   ├── configs.ts  models.ts  templates.ts
│   │   ├── history.ts  groups.ts  notifications.ts
│   │   └── availability.ts
│   ├── core/                        # 轮询器（原 check-cx，去掉租约）
│   ├── providers/  official-status/ # 检测逻辑（原样保留）
│   ├── admin/                       # 后台业务逻辑（去掉 supabase-admin / server-env）
│   ├── types/                       # 合并两边类型定义
│   └── utils/
├── components/                      # 合并两边 UI 组件（ui/ + admin/）
├── hooks/                           # 原 admin 的 hooks
├── middleware.ts                    # 【新】只保护 /admin/*（口令 cookie）
├── instrumentation.ts               # 启动轮询器
├── data/                            # 【新】SQLite 文件目录（monitor.db，volume 持久化）
├── package.json                     # 合并依赖，去掉 @supabase/*，加 better-sqlite3
└── ...
```

**路径约定**：

- 公开面板用 route group `(public)`，URL 保持 `/`、`/group/*` 不变。
- 后台统一挂 `/admin/*`（原 admin 的 `/dashboard/*` → `/admin/*`，登录页 `/admin/login`）。
- 删除：所有 `lib/supabase/*`、`lib/admin/supabase-admin.ts`、`lib/admin/server-env.ts`（SUPABASE 相关）、`check-cx-admin/proxy.ts`。

## 4. SQLite Schema 与数据访问层（核心）

### 4.1 Postgres → SQLite Schema 平移映射

| Postgres 特性 | SQLite 处理方式 |
|---|---|
| `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | `TEXT PRIMARY KEY`；UUID 在应用层用 `crypto.randomUUID()` 生成后插入 |
| `ENUM provider_type` | `TEXT` + `CHECK(type IN ('openai','gemini','anthropic'))` |
| `jsonb`（request_header / metadata） | `TEXT` 存 JSON 字符串；读 `JSON.parse`、写 `JSON.stringify` |
| `timestamptz DEFAULT now()` | `TEXT` 存 ISO8601（`new Date().toISOString()`），应用层统一生成 |
| `bigint GENERATED ... IDENTITY`（check_history.id） | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `boolean` | `INTEGER`（0/1），封装层做 `Boolean()` 转换 |
| 触发器 `update_updated_at_column` | 不用触发器；写操作时在 TS 显式设 `updated_at` |
| 触发器 `validate_check_model_template_type` / `validate_check_config_model_type` | 移到 TS 写入逻辑做 type 一致性校验 |
| 视图 `availability_stats` | `lib/db/availability.ts` 参数化 SQL（用 `julianday('now') - julianday(checked_at)` 算时间窗口） |
| RPC `get_check_history_by_time`（带采样） | TS 函数：SQL 取时间窗口数据 + JS 做采样（首尾点 + 步长采样） |
| RPC `get_recent_check_history` | SQL：`check_history` JOIN `check_configs`/`check_models`，窗口函数 `ROW_NUMBER() OVER (PARTITION BY config_id ORDER BY checked_at DESC)` 取每 config 最近 N 条 |
| RPC `prune_check_history` | TS：`DELETE FROM check_history WHERE checked_at < ?`（cutoff ISO 字符串） |
| `ON DELETE CASCADE` / `RESTRICT` | SQLite 外键支持，需 `PRAGMA foreign_keys = ON` |

**关键约定**：

- **时间统一 ISO8601 文本**。现有代码用 `new Date(row.checked_at).getTime()` 和 `.toISOString()`，ISO 文本天然兼容，且 ISO8601 字典序 = 时间序，`ORDER BY checked_at` 直接正确。
- **UUID 应用层生成**（`crypto.randomUUID()`），替代 `gen_random_uuid()`。
- SQLite 的窗口函数（`ROW_NUMBER`）需 SQLite ≥ 3.25，`better-sqlite3` 内置版本满足。

涉及的表（全部平移）：`check_request_templates`、`check_models`、`check_configs`、`check_history`、`group_info`、`system_notifications`。
**删除表**：`check_poller_leases`（轮询租约，不再需要）。

### 4.2 数据库连接（`lib/db/client.ts`）

```ts
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.SQLITE_DB_PATH ?? "./data/monitor.db";
  db = new Database(path);
  db.pragma("journal_mode = WAL");   // 并发读 + 单写，适合轮询写 + 面板读
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");  // 写锁等待，避免偶发 SQLITE_BUSY
  return db;
}
```

进程内单例，`better-sqlite3` 同步 API，WAL 模式让"轮询器写 + 面板多请求读"不互相阻塞。

### 4.3 数据访问层封装策略

每张表一个模块（`configs.ts` / `history.ts` 等），导出与现有调用点**同名同签名**的函数，上层（API routes、server actions、poller）只改 import 来源，逻辑基本不动。示例：

```ts
// lib/db/history.ts —— 替代原 supabase 的 append
export async function appendHistory(records: CheckHistoryInsert[]): Promise<void> {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO check_history
       (config_id, status, latency_ms, ping_latency_ms, checked_at, message, created_at)
     VALUES (@config_id, @status, @latency_ms, @ping_latency_ms, @checked_at, @message, @created_at)`
  );
  const insertMany = db.transaction((rows: CheckHistoryInsert[]) => {
    for (const r of rows) stmt.run(r);
  });
  insertMany(records);
}
```

**返回值契约变化**：原 supabase 调用返回 `{ data, error }`，改造后**直接返回数据 / 抛异常**。每个调用点的 `const { data, error } = await ...` 改写为 `try/catch` 或直接取返回值。这是改动量最大的部分，但都是机械化替换。

### 4.4 关于 async

`better-sqlite3` 是同步 API。为最小化改动，数据层函数**保留 `async` 签名**（同步实现包一层 Promise / 直接 `async` 函数），上层的 `await` 全部保留不动。

## 5. 认证与中间件

- 新建根 `middleware.ts`，**只保护 `/admin/*`**（放行 `/admin/login`、`/auth/*`）：复用原 admin 的 `verifySessionToken`（HMAC cookie 校验），无有效 session → 重定向 `/admin/login`。
- 公开面板与公开 API（`/`、`/group/*`、`/api/dashboard`、`/api/v1/status`、`/api/notifications`）**完全放行**。
- 保留 `ADMIN_LOGIN_KEY` + `ADMIN_SESSION_SECRET`；`lib/admin/session.ts`、`lib/admin/auth.ts` 原样保留（不依赖 Supabase）。
- 删除两个项目的 `lib/supabase/middleware.ts`、`check-cx-admin/proxy.ts`。
- 权限分组（`lib/admin/permissions.ts` 的 `groupName` scope）保留：后台查询里的 `applyConfigScope` 改写为 SQL `WHERE group_name = ?`。

## 6. 轮询器简化

- **删除**：`lib/core/poller-leadership.ts`、`lib/database/poller-lease.ts`、`check_poller_leases` 表、`global-state.ts` 的 `PollerRole` / leader timer 状态、env `CHECK_NODE_ID`。
- `poller.ts` 的 `ensurePollerLeadership()` / `isPollerLeader()` 调用 → 替换为**进程内单例守卫**（复用 `global-state.ts` 已有的 `isPollerRunning()` / `setPollerRunning()`，保证一个进程只启动一次）。
- `instrumentation.ts` 原样保留（启动时 `import('@/lib/core/poller')`）。
- 后台 `system` 页展示"轮询租约状态"的卡片（`getPollerLease`）→ 改为展示进程内"轮询器运行中 / 上次轮询时间"，或移除该卡片。

## 7. 依赖与配置变更

### 7.1 package.json

以 check-cx 依赖为基线（功能更全：ai-sdk、recharts、dnd-kit 等），合并 admin 独有项（`@base-ui/react`、`shadcn`），然后：

- **删除**：`@supabase/ssr`、`@supabase/supabase-js`
- **新增**：`better-sqlite3`、`@types/better-sqlite3`（dev）、`vitest`（dev）
- Next 版本统一到 `16.2.6`

### 7.2 环境变量（合并后 `.env`）

```
NODE_ENV=production
SQLITE_DB_PATH=./data/monitor.db        # 新增
ADMIN_LOGIN_KEY=...                      # 保留（后台登录口令）
ADMIN_SESSION_SECRET=...                 # 保留（cookie HMAC 签名）
APP_URL=...                              # 保留（后台重定向）
CHECK_POLL_INTERVAL_SECONDS=60           # 保留
HISTORY_RETENTION_DAYS=30                # 保留
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=60
CHECK_CONCURRENCY=8
# 删除：所有 SUPABASE_*、SUPABASE_DB_SCHEMA、CHECK_NODE_ID
```

### 7.3 Dockerfile

`better-sqlite3` 是原生模块，构建阶段需编译：

- 构建镜像加 `python3 make g++`（Alpine：`apk add --no-cache python3 make g++`）。
- `data/` 目录用 volume 挂载，持久化 SQLite 文件（含 WAL 边车文件 `-wal` / `-shm`）。
- 合并两个项目的 `docker-compose.yml` 为一个服务。

## 8. 数据库初始化

启动时（`lib/db/client.ts` 首次连接后调用 `lib/db/migrate.ts`）执行：读 `lib/db/schema.sql`，用 `db.exec()` 建表（全部 `CREATE TABLE IF NOT EXISTS`），幂等。首次运行自动建空库，无需手动建表。

## 9. 测试策略

- 引入 **Vitest**（两项目现无测试框架）。
- **数据层单测**：对 `lib/db/*` 每个模块，用 `new Database(':memory:')` 建表后跑增删改查，验证：UUID 生成、JSON 序列化往返、ISO 时间排序、外键级联删除（删 config 级联删 history）、可用性统计 SQL 正确（7/15/30 天窗口）。
- **采样函数单测**：验证 `get_check_history_by_time` 的 TS 采样版，大数据量下每 config 返回点数受限且保留首尾点。
- **type 校验单测**：验证写入 model/config 时 template type 不一致会抛错（替代原触发器）。
- **冒烟验证**：`pnpm build` 通过；启动后公开面板能读、后台登录后能增删配置、轮询器能写入历史。

## 10. 实施阶段拆分（供 writing-plans 细化）

1. **脚手架合并**：以 check-cx 为基底，建立统一目录、合并 package.json、引入 better-sqlite3 + vitest。
2. **SQLite 数据层**：`lib/db/client.ts` + `schema.sql` + `migrate.ts` + 各表模块（TDD：先写数据层单测）。
3. **替换 check-cx 调用点**：`config-loader`、`history`、`availability`、`group-info`、`notifications` 改走 `lib/db`，删 `lib/supabase`。
4. **轮询器去租约**：删 leadership/lease，改进程内单例守卫。
5. **迁入 admin**：后台页面挂 `/admin/*`，`lib/admin/queries.ts` + 各 `actions.ts` 改走 `lib/db`，删 `supabase-admin`/`server-env`。
6. **中间件与认证**：根 `middleware.ts` 保护 `/admin/*`，删 supabase middleware。
7. **配置与部署**：合并 `.env`、Dockerfile、docker-compose。
8. **验证**：`pnpm build` + 全量单测 + 冒烟。

## 11. 风险与权衡

- **不可水平扩展**：单 SQLite 文件 + 单进程是本方案前提；多实例会有写锁冲突与重复轮询。若未来需扩展，须回到 Postgres 或换 client/server 数据库。
- **原生模块编译**：`better-sqlite3` 在不同平台需重新编译，CI/Docker 构建环境需带编译工具链。
- **写并发**：轮询写入集中在单进程，WAL + `busy_timeout` 已覆盖面板读与轮询写的并发；若后续写入量激增需评估批量事务。
- **数据不迁移**：现有 Supabase 数据不带入，配置需后台重录；若线上已有重要数据，需另立"数据迁移"子任务（本方案未含）。

