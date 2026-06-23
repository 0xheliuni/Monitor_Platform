# Check CX 合并与 SQLite 改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 check-cx（公开面板+轮询器）与 check-cx-admin（管理后台）合并为单一 Next.js 16 应用，并把数据库从 Supabase（Postgres）迁移到 SQLite（better-sqlite3）。

**Architecture:** 以 check-cx 为基底，原地引入 SQLite 数据访问层 `lib/db/*` 替换所有 `@supabase/*` 调用；把 admin 的后台页面/逻辑迁入同一应用挂在 `/admin/*`；轮询器去掉多节点租约改进程内单例；中间件只保护 `/admin/*`。单进程单 SQLite 文件，WAL 模式。

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5 · better-sqlite3 · Vitest · pnpm · Tailwind v4

## Global Constraints

- 合并后的工作目录根：`E:\Prod_Project\other\Monitor_Platform`（已是 git 仓库，`.gitignore` 已忽略 `check-cx/`、`check-cx-admin/` 两个原始子项目目录）。
- 基底代码取自 `check-cx`；admin 代码从 `check-cx-admin` 拷入。两个原始目录保留只读，作为参考来源，**不在其内修改**。
- 时间一律存 ISO8601 文本（`new Date().toISOString()`）；ID 一律应用层 `crypto.randomUUID()` 生成；JSON 字段存字符串。
- 布尔存 `INTEGER`(0/1)；`check_history.id` 用 `INTEGER PRIMARY KEY AUTOINCREMENT`。
- 数据层函数保留 `async` 签名（同步实现）。返回值契约：成功返回数据 / 失败抛异常（不再有 `{data,error}`）。
- 可用性口径：`operational + degraded` 视为可用（最新口径）。
- Next 版本统一 `16.2.6`；移除 `@supabase/ssr`、`@supabase/supabase-js`；新增 `better-sqlite3`、`@types/better-sqlite3`、`vitest`。
- 删除：`lib/supabase/*`、`lib/admin/supabase-admin.ts`、`lib/admin/server-env.ts`、`lib/core/poller-leadership.ts`、`lib/database/poller-lease.ts`、`check_poller_leases` 表、env `SUPABASE_*`/`CHECK_NODE_ID`。
- pnpm 命令在仓库根执行；测试用 `pnpm vitest run`。

---

## File Structure (decomposition)

**新建（SQLite 数据层）：**
- `lib/db/client.ts` — better-sqlite3 单例连接 + PRAGMA + `getDb()`。
- `lib/db/schema.sql` — SQLite 建表脚本（6 张表，从 Postgres 平移）。
- `lib/db/migrate.ts` — 读 schema.sql 幂等建表 `runMigrations()`。
- `lib/db/configs.ts` — 配置读写（替代 config-loader 的 DB 部分 + admin 的 config 查询/写入）。
- `lib/db/models.ts` — 模型读写。
- `lib/db/templates.ts` — 模板读写。
- `lib/db/history.ts` — 历史读写 + 采样 + 清理。
- `lib/db/groups.ts` — 分组信息读写。
- `lib/db/notifications.ts` — 系统通知读写。
- `lib/db/availability.ts` — 可用性统计 SQL。
- `lib/db/json.ts` — JSON / 布尔 / 时间 编解码小工具。
- `tests/db/*.test.ts` — 各模块单测（内存库）。

**修改（基底来自 check-cx）：**
- `lib/database/config-loader.ts`、`history.ts`、`availability.ts`、`group-info.ts`、`notifications.ts` — 改走 `lib/db`。
- `lib/core/poller.ts`、`lib/core/global-state.ts` — 去租约，进程内单例。
- `middleware.ts`（新建根）、`instrumentation.ts`（保留）。
- `package.json`、`.env`、`.env.example`、`Dockerfile`、`docker-compose.yml`、`vitest.config.ts`（新建）。

**迁入（来自 check-cx-admin）：**
- `app/admin/**`（原 `app/dashboard/**` + `app/login`）、`app/auth/**`、`components/admin/**`、`hooks/**`、`lib/admin/**`（除 supabase-admin/server-env）。

---

### Task 1: 脚手架合并与依赖

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: 可运行 `pnpm install`、`pnpm vitest run`、`pnpm build` 的统一项目根。

- [ ] **Step 1: 确认基底已就位**

仓库根 `E:\Prod_Project\other\Monitor_Platform` 下已有 check-cx 的全部文件（基底）。若根目录还没有 `package.json`，先把 check-cx 的内容铺到根：

Run（PowerShell）:
```powershell
Get-ChildItem "E:\Prod_Project\other\Monitor_Platform\package.json"
```
Expected: 若不存在则报错。不存在时执行：
```powershell
Copy-Item "E:\Prod_Project\other\Monitor_Platform\check-cx\*" "E:\Prod_Project\other\Monitor_Platform\" -Recurse -Force -Exclude @('.git','node_modules','.next')
```
Expected: 根目录出现 `app/`、`lib/`、`package.json` 等。

## File Structure (decomposition)

**新建（SQLite 数据层）：**
- `lib/db/client.ts` — better-sqlite3 单例连接 + PRAGMA + `getDb()`。
- `lib/db/schema.sql` — SQLite 建表脚本（6 张表，从 Postgres 平移）。
- `lib/db/migrate.ts` — 读 schema.sql 幂等建表 `runMigrations()`。
- `lib/db/configs.ts` — 配置读写（替代 config-loader 的 DB 部分 + admin 的 config 查询/写入）。
- `lib/db/models.ts` — 模型读写。
- `lib/db/templates.ts` — 模板读写。
- `lib/db/history.ts` — 历史读写 + 采样 + 清理。
- `lib/db/groups.ts` — 分组信息读写。
- `lib/db/notifications.ts` — 系统通知读写。
- `lib/db/availability.ts` — 可用性统计 SQL。
- `lib/db/json.ts` — JSON / 布尔 / 时间 编解码小工具。
- `tests/db/*.test.ts` — 各模块单测（内存库）。

**修改（基底来自 check-cx）：**
- `lib/database/config-loader.ts`、`history.ts`、`availability.ts`、`group-info.ts`、`notifications.ts` — 改走 `lib/db`。
- `lib/core/poller.ts`、`lib/core/global-state.ts` — 去租约，进程内单例。
- `middleware.ts`（新建根）、`instrumentation.ts`（保留）。
- `package.json`、`.env`、`.env.example`、`Dockerfile`、`docker-compose.yml`、`vitest.config.ts`（新建）。

**迁入（来自 check-cx-admin）：**
- `app/admin/**`（原 `app/dashboard/**` + `app/login`）、`app/auth/**`、`components/admin/**`、`hooks/**`、`lib/admin/**`（除 supabase-admin/server-env）。

---

### Task 1: 脚手架合并与依赖

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: 可运行 `pnpm install`、`pnpm vitest run`、`pnpm build` 的统一项目根。

- [ ] **Step 1: 确认基底已就位**

仓库根 `E:\Prod_Project\other\Monitor_Platform` 下已有 check-cx 的全部文件（基底）。若根目录还没有 `package.json`，先把 check-cx 的内容铺到根：

Run（PowerShell）:
```powershell
Get-ChildItem "E:\Prod_Project\other\Monitor_Platform\package.json"
```
Expected: 若不存在则报错。不存在时执行：
```powershell
Copy-Item "E:\Prod_Project\other\Monitor_Platform\check-cx\*" "E:\Prod_Project\other\Monitor_Platform\" -Recurse -Force -Exclude @('.git','node_modules','.next')
```
Expected: 根目录出现 `app/`、`lib/`、`package.json` 等。

- [ ] **Step 2: 改 package.json**

把 `name` 改为 `monitor-platform`，移除 supabase，加 better-sqlite3 + vitest。`dependencies` 删除这两行：
```json
"@supabase/ssr": "^0.9.0",
"@supabase/supabase-js": "^2.103.0",
```
`dependencies` 增加：
```json
"better-sqlite3": "^11.8.1",
```
`devDependencies` 增加：
```json
"@types/better-sqlite3": "^7.6.12",
"vitest": "^3.0.5",
```
`scripts` 增加：
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 新建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`
Expected: 安装成功，`better-sqlite3` 完成原生编译（Windows 需已装 VS Build Tools；失败则 `pnpm rebuild better-sqlite3`）。

- [ ] **Step 5: 写 .env.example（合并后）**

```
NODE_ENV=production
SQLITE_DB_PATH=./data/monitor.db
ADMIN_LOGIN_KEY=change-me
ADMIN_SESSION_SECRET=change-me-to-32+bytes-random
APP_URL=http://localhost:3000
CHECK_POLL_INTERVAL_SECONDS=60
HISTORY_RETENTION_DAYS=30
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=60
CHECK_CONCURRENCY=8
```

- [ ] **Step 6: 提交**

```bash
git add package.json vitest.config.ts .env.example
git commit -m "chore: 统一脚手架，移除 supabase 依赖，引入 better-sqlite3 + vitest"
```

---

### Task 2: SQLite 连接与 schema 建表

**Files:**
- Create: `lib/db/client.ts`
- Create: `lib/db/schema.sql`
- Create: `lib/db/migrate.ts`
- Create: `tests/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `getDb(): Database.Database`（lib/db/client.ts）
  - `runMigrations(db?: Database.Database): void`（lib/db/migrate.ts，幂等）
  - `lib/db/schema.sql` 含表：`check_request_templates`、`check_models`、`check_configs`、`check_history`、`group_info`、`system_notifications`。

- [ ] **Step 1: 写 schema.sql**

`lib/db/schema.sql`：
```sql
CREATE TABLE IF NOT EXISTS check_request_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  request_header TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_models (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  model TEXT NOT NULL,
  template_id TEXT REFERENCES check_request_templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, model)
);

CREATE TABLE IF NOT EXISTS check_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  model_id TEXT NOT NULL REFERENCES check_models(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  group_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id TEXT NOT NULL REFERENCES check_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('operational','degraded','failed','validation_failed','error')),
  latency_ms INTEGER,
  ping_latency_ms REAL,
  checked_at TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_info (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL UNIQUE,
  website_url TEXT,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','error')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_history_config_id ON check_history (config_id);
CREATE INDEX IF NOT EXISTS idx_check_history_checked_at ON check_history (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_config_checked ON check_history (config_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_configs_model_id ON check_configs (model_id);
CREATE INDEX IF NOT EXISTS idx_check_models_template_id ON check_models (template_id);
```

- [ ] **Step 2: 改 package.json**

把 `name` 改为 `monitor-platform`，移除 supabase，加 better-sqlite3 + vitest。`dependencies` 删除这两行：
```json
"@supabase/ssr": "^0.9.0",
"@supabase/supabase-js": "^2.103.0",
```
`dependencies` 增加：
```json
"better-sqlite3": "^11.8.1",
```
`devDependencies` 增加：
```json
"@types/better-sqlite3": "^7.6.12",
"vitest": "^3.0.5",
```
`scripts` 增加：
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 新建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`
Expected: 安装成功，`better-sqlite3` 完成原生编译（Windows 需已装 VS Build Tools；失败则 `pnpm rebuild better-sqlite3`）。

- [ ] **Step 5: 写 .env.example（合并后）**

```
NODE_ENV=production
SQLITE_DB_PATH=./data/monitor.db
ADMIN_LOGIN_KEY=change-me
ADMIN_SESSION_SECRET=change-me-to-32+bytes-random
APP_URL=http://localhost:3000
CHECK_POLL_INTERVAL_SECONDS=60
HISTORY_RETENTION_DAYS=30
OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS=60
CHECK_CONCURRENCY=8
```

- [ ] **Step 6: 提交**

```bash
git add package.json vitest.config.ts .env.example
git commit -m "chore: 统一脚手架，移除 supabase 依赖，引入 better-sqlite3 + vitest"
```

---

### Task 2: SQLite 连接与 schema 建表

**Files:**
- Create: `lib/db/client.ts`
- Create: `lib/db/schema.sql`
- Create: `lib/db/migrate.ts`
- Create: `tests/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `getDb(): Database.Database`（lib/db/client.ts）
  - `runMigrations(db?: Database.Database): void`（lib/db/migrate.ts，幂等）
  - `lib/db/schema.sql` 含表：`check_request_templates`、`check_models`、`check_configs`、`check_history`、`group_info`、`system_notifications`。

- [ ] **Step 1: 写 schema.sql**

`lib/db/schema.sql`：
```sql
CREATE TABLE IF NOT EXISTS check_request_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  request_header TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_models (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  model TEXT NOT NULL,
  template_id TEXT REFERENCES check_request_templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, model)
);

CREATE TABLE IF NOT EXISTS check_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('openai','gemini','anthropic')),
  model_id TEXT NOT NULL REFERENCES check_models(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  group_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id TEXT NOT NULL REFERENCES check_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('operational','degraded','failed','validation_failed','error')),
  latency_ms INTEGER,
  ping_latency_ms REAL,
  checked_at TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_info (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL UNIQUE,
  website_url TEXT,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','error')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_history_config_id ON check_history (config_id);
CREATE INDEX IF NOT EXISTS idx_check_history_checked_at ON check_history (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_config_checked ON check_history (config_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_configs_model_id ON check_configs (model_id);
CREATE INDEX IF NOT EXISTS idx_check_models_template_id ON check_models (template_id);
```

- [ ] **Step 2: 写 client.ts**

`lib/db/client.ts`：
```ts
import "server-only";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.SQLITE_DB_PATH ?? "./data/monitor.db";
  const instance = new Database(path);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
  db = instance;
  return db;
}

// 测试用：注入内存库或自定义实例
export function __setDbForTest(instance: Database.Database | null): void {
  db = instance;
}
```

- [ ] **Step 3: 写 migrate.ts**

`lib/db/migrate.ts`：
```ts
import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "./client";

export function runMigrations(db: Database.Database = getDb()): void {
  const schemaPath = resolve(process.cwd(), "lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  db.exec(sql);
}
```

- [ ] **Step 4: 写失败测试**

`tests/db/migrate.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  return db;
}

describe("schema", () => {
  it("创建全部 6 张表", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("check_configs");
    expect(names).toContain("check_models");
    expect(names).toContain("check_request_templates");
    expect(names).toContain("check_history");
    expect(names).toContain("group_info");
    expect(names).toContain("system_notifications");
    expect(names).not.toContain("check_poller_leases");
  });

  it("外键级联：删 config 连带删 history", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO check_request_templates (id,name,type,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("t1", "tpl", "openai", now, now);
    db.prepare("INSERT INTO check_models (id,type,model,template_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("m1", "openai", "gpt", "t1", now, now);
    db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("c1", "cfg", "openai", "m1", "http://x", "k", now, now);
    db.prepare("INSERT INTO check_history (config_id,status,checked_at,created_at) VALUES (?,?,?,?)")
      .run("c1", "operational", now, now);
    db.prepare("DELETE FROM check_configs WHERE id=?").run("c1");
    const count = db.prepare("SELECT COUNT(*) AS n FROM check_history").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run tests/db/migrate.test.ts`
Expected: 2 passed（schema.sql 已写好，应直接通过）。

- [ ] **Step 6: 提交**

```bash
git add lib/db/client.ts lib/db/schema.sql lib/db/migrate.ts tests/db/migrate.test.ts
git commit -m "feat(db): SQLite 连接、schema 建表与迁移"
```

---

### Task 3: db/json.ts 编解码工具

**Files:**
- Create: `lib/db/json.ts`
- Create: `tests/db/json.test.ts`

**Interfaces:**
- Produces:
  - `toJson(value: unknown): string | null`
  - `fromJson<T>(text: string | null): T | null`
  - `toBool(value: 0 | 1 | null | undefined): boolean`
  - `fromBool(value: boolean | null | undefined): 0 | 1`
  - `nowIso(): string`
  - `newId(): string`

- [ ] **Step 1: 写失败测试**

`tests/db/json.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { toJson, fromJson, toBool, fromBool, nowIso, newId } from "@/lib/db/json";

describe("json/bool/id helpers", () => {
  it("toJson/fromJson 往返", () => {
    expect(toJson(null)).toBeNull();
    expect(toJson({ a: 1 })).toBe('{"a":1}');
    expect(fromJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(fromJson(null)).toBeNull();
  });
  it("bool 编解码", () => {
    expect(fromBool(true)).toBe(1);
    expect(fromBool(false)).toBe(0);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
  });
  it("nowIso 是 ISO 字符串，newId 是 uuid", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/json.test.ts`
Expected: FAIL（`@/lib/db/json` 不存在）。

- [ ] **Step 3: 实现 json.ts**

`lib/db/json.ts`：
```ts
import { randomUUID } from "node:crypto";

export function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function toBool(value: 0 | 1 | null | undefined): boolean {
  return value === 1;
}

export function fromBool(value: boolean | null | undefined): 0 | 1 {
  return value ? 1 : 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/json.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/json.ts tests/db/json.test.ts
git commit -m "feat(db): JSON/布尔/时间/ID 编解码工具"
```

- [ ] **Step 2: 写 client.ts**

`lib/db/client.ts`：
```ts
import "server-only";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.SQLITE_DB_PATH ?? "./data/monitor.db";
  const instance = new Database(path);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
  db = instance;
  return db;
}

// 测试用：注入内存库或自定义实例
export function __setDbForTest(instance: Database.Database | null): void {
  db = instance;
}
```

- [ ] **Step 3: 写 migrate.ts**

`lib/db/migrate.ts`：
```ts
import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "./client";

export function runMigrations(db: Database.Database = getDb()): void {
  const schemaPath = resolve(process.cwd(), "lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  db.exec(sql);
}
```

- [ ] **Step 4: 写失败测试**

`tests/db/migrate.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  return db;
}

describe("schema", () => {
  it("创建全部 6 张表", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("check_configs");
    expect(names).toContain("check_models");
    expect(names).toContain("check_request_templates");
    expect(names).toContain("check_history");
    expect(names).toContain("group_info");
    expect(names).toContain("system_notifications");
    expect(names).not.toContain("check_poller_leases");
  });

  it("外键级联：删 config 连带删 history", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO check_request_templates (id,name,type,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("t1", "tpl", "openai", now, now);
    db.prepare("INSERT INTO check_models (id,type,model,template_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("m1", "openai", "gpt", "t1", now, now);
    db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("c1", "cfg", "openai", "m1", "http://x", "k", now, now);
    db.prepare("INSERT INTO check_history (config_id,status,checked_at,created_at) VALUES (?,?,?,?)")
      .run("c1", "operational", now, now);
    db.prepare("DELETE FROM check_configs WHERE id=?").run("c1");
    const count = db.prepare("SELECT COUNT(*) AS n FROM check_history").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run tests/db/migrate.test.ts`
Expected: 2 passed（schema.sql 已写好，应直接通过）。

- [ ] **Step 6: 提交**

```bash
git add lib/db/client.ts lib/db/schema.sql lib/db/migrate.ts tests/db/migrate.test.ts
git commit -m "feat(db): SQLite 连接、schema 建表与迁移"
```

---

### Task 3: db/json.ts 编解码工具

**Files:**
- Create: `lib/db/json.ts`
- Create: `tests/db/json.test.ts`

**Interfaces:**
- Produces:
  - `toJson(value: unknown): string | null`
  - `fromJson<T>(text: string | null): T | null`
  - `toBool(value: 0 | 1 | null | undefined): boolean`
  - `fromBool(value: boolean | null | undefined): 0 | 1`
  - `nowIso(): string`
  - `newId(): string`

- [ ] **Step 1: 写失败测试**

`tests/db/json.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { toJson, fromJson, toBool, fromBool, nowIso, newId } from "@/lib/db/json";

describe("json/bool/id helpers", () => {
  it("toJson/fromJson 往返", () => {
    expect(toJson(null)).toBeNull();
    expect(toJson({ a: 1 })).toBe('{"a":1}');
    expect(fromJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(fromJson(null)).toBeNull();
  });
  it("bool 编解码", () => {
    expect(fromBool(true)).toBe(1);
    expect(fromBool(false)).toBe(0);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
  });
  it("nowIso 是 ISO 字符串，newId 是 uuid", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/json.test.ts`
Expected: FAIL（`@/lib/db/json` 不存在）。

- [ ] **Step 3: 实现 json.ts**

`lib/db/json.ts`：
```ts
import { randomUUID } from "node:crypto";

export function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function toBool(value: 0 | 1 | null | undefined): boolean {
  return value === 1;
}

export function fromBool(value: boolean | null | undefined): 0 | 1 {
  return value ? 1 : 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/json.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/json.ts tests/db/json.test.ts
git commit -m "feat(db): JSON/布尔/时间/ID 编解码工具"
```

---

### Task 4: db/history.ts — 最近历史、写入、采样、清理

**Files:**
- Create: `lib/db/history.ts`
- Create: `tests/db/history.test.ts`

**Interfaces:**
- Consumes: `getDb`、`runMigrations`、`nowIso`（来自 client/migrate/json）。
- Produces:
  - `type RecentHistoryRow = { config_id: string; status: string; latency_ms: number | null; ping_latency_ms: number | null; checked_at: string; message: string | null; name: string; type: string; model: string; endpoint: string | null; group_name: string | null }`
  - `type HistoryInsert = { config_id: string; status: string; latency_ms: number | null; ping_latency_ms: number | null; checked_at: string; message: string | null }`
  - `async function getRecentCheckHistory(limitPerConfig: number, targetConfigIds: string[] | null): Promise<RecentHistoryRow[]>`
  - `async function insertHistory(records: HistoryInsert[]): Promise<void>`
  - `async function pruneCheckHistory(retentionDays: number): Promise<number>`
  - `async function getCheckHistoryByTime(sinceMs: number, targetConfigIds: string[] | null, maxPointsPerConfig: number): Promise<{ config_id: string; status: string; latency_ms: number | null; checked_at: string }[]>`（带采样）

- [ ] **Step 1: 写失败测试**

`tests/db/history.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import {
  insertHistory,
  getRecentCheckHistory,
  pruneCheckHistory,
  getCheckHistoryByTime,
} from "@/lib/db/history";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("m1", "openai", "gpt-4o", now, now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("c1", "Cfg1", "openai", "m1", "http://x", "k", "G1", now, now);
  __setDbForTest(db);
  return db;
}

beforeEach(() => seed());

describe("history", () => {
  it("insert 后 getRecentCheckHistory 带 join 字段", async () => {
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 100, ping_latency_ms: 5, checked_at: "2026-06-24T10:00:00.000Z", message: null },
      { config_id: "c1", status: "degraded", latency_ms: 200, ping_latency_ms: 6, checked_at: "2026-06-24T11:00:00.000Z", message: "slow" },
    ]);
    const rows = await getRecentCheckHistory(60, null);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Cfg1");
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].group_name).toBe("G1");
    // DESC：最新在前
    expect(rows[0].checked_at).toBe("2026-06-24T11:00:00.000Z");
  });

  it("limitPerConfig 限制每个 config 条数", async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: `2026-06-24T1${i}:00:00.000Z`, message: null,
    }));
    await insertHistory(recs);
    const rows = await getRecentCheckHistory(3, ["c1"]);
    expect(rows.length).toBe(3);
  });

  it("prune 删除超期记录，返回删除数", async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: old, message: null },
      { config_id: "c1", status: "operational", latency_ms: 2, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const deleted = await pruneCheckHistory(30);
    expect(deleted).toBe(1);
  });

  it("getCheckHistoryByTime 采样保留首尾且不超过上限", async () => {
    const base = Date.now();
    const recs = Array.from({ length: 100 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: new Date(base - (100 - i) * 1000).toISOString(), message: null,
    }));
    await insertHistory(recs);
    const rows = await getCheckHistoryByTime(3600_000, ["c1"], 10);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/history.test.ts`
Expected: FAIL（`@/lib/db/history` 不存在）。

- [ ] **Step 3: 实现 history.ts**

`lib/db/history.ts`：
```ts
import "server-only";
import { getDb } from "./client";
import { nowIso } from "./json";

export type RecentHistoryRow = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
  name: string; type: string; model: string; endpoint: string | null; group_name: string | null;
};
export type HistoryInsert = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
};

export async function insertHistory(records: HistoryInsert[]): Promise<void> {
  if (records.length === 0) return;
  const db = getDb();
  const created = nowIso();
  const stmt = db.prepare(
    `INSERT INTO check_history (config_id,status,latency_ms,ping_latency_ms,checked_at,message,created_at)
     VALUES (@config_id,@status,@latency_ms,@ping_latency_ms,@checked_at,@message,@created_at)`
  );
  const tx = db.transaction((rows: HistoryInsert[]) => {
    for (const r of rows) stmt.run({ ...r, created_at: created });
  });
  tx(records);
}

export async function getRecentCheckHistory(
  limitPerConfig: number,
  targetConfigIds: string[] | null
): Promise<RecentHistoryRow[]> {
  const db = getDb();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `WHERE h.config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const sql = `
    WITH ranked AS (
      SELECT h.config_id, h.status, h.latency_ms, h.ping_latency_ms, h.checked_at, h.message,
             row_number() OVER (PARTITION BY h.config_id ORDER BY h.checked_at DESC) AS rn
      FROM check_history h ${filter}
    )
    SELECT r.config_id, r.status, r.latency_ms, r.ping_latency_ms, r.checked_at, r.message,
           c.name, c.type, m.model, c.endpoint, c.group_name
    FROM ranked r
    JOIN check_configs c ON c.id = r.config_id
    JOIN check_models m ON m.id = c.model_id
    WHERE r.rn <= ?
    ORDER BY c.name ASC, r.checked_at DESC`;
  const params = targetConfigIds && targetConfigIds.length > 0
    ? [...targetConfigIds, limitPerConfig] : [limitPerConfig];
  return db.prepare(sql).all(...params) as RecentHistoryRow[];
}

export async function pruneCheckHistory(retentionDays: number): Promise<number> {
  const db = getDb();
  const effective = Math.min(365, Math.max(7, retentionDays || 30));
  const cutoff = new Date(Date.now() - effective * 86400000).toISOString();
  const info = db.prepare("DELETE FROM check_history WHERE checked_at < ?").run(cutoff);
  return info.changes;
}

export async function getCheckHistoryByTime(
  sinceMs: number,
  targetConfigIds: string[] | null,
  maxPointsPerConfig: number
): Promise<{ config_id: string; status: string; latency_ms: number | null; checked_at: string }[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `AND config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const params = targetConfigIds && targetConfigIds.length > 0 ? [cutoff, ...targetConfigIds] : [cutoff];
  const all = db.prepare(
    `SELECT config_id, status, latency_ms, checked_at FROM check_history
     WHERE checked_at > ? ${filter} ORDER BY config_id, checked_at ASC`
  ).all(...params) as { config_id: string; status: string; latency_ms: number | null; checked_at: string }[];

  const byConfig = new Map<string, typeof all>();
  for (const row of all) {
    const list = byConfig.get(row.config_id);
    if (list) list.push(row); else byConfig.set(row.config_id, [row]);
  }
  const result: typeof all = [];
  for (const list of byConfig.values()) {
    const total = list.length;
    const step = Math.max(1, Math.floor(total / maxPointsPerConfig));
    list.forEach((row, i) => {
      if (i === 0 || i === total - 1 || i % step === 0) result.push(row);
    });
  }
  return result;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/history.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/history.ts tests/db/history.test.ts
git commit -m "feat(db): 历史读写、最近历史 join、采样与清理"
```

---

### Task 4: db/history.ts — 最近历史、写入、采样、清理

**Files:**
- Create: `lib/db/history.ts`
- Create: `tests/db/history.test.ts`

**Interfaces:**
- Consumes: `getDb`、`runMigrations`、`nowIso`（来自 client/migrate/json）。
- Produces:
  - `type RecentHistoryRow = { config_id: string; status: string; latency_ms: number | null; ping_latency_ms: number | null; checked_at: string; message: string | null; name: string; type: string; model: string; endpoint: string | null; group_name: string | null }`
  - `type HistoryInsert = { config_id: string; status: string; latency_ms: number | null; ping_latency_ms: number | null; checked_at: string; message: string | null }`
  - `async function getRecentCheckHistory(limitPerConfig: number, targetConfigIds: string[] | null): Promise<RecentHistoryRow[]>`
  - `async function insertHistory(records: HistoryInsert[]): Promise<void>`
  - `async function pruneCheckHistory(retentionDays: number): Promise<number>`
  - `async function getCheckHistoryByTime(sinceMs: number, targetConfigIds: string[] | null, maxPointsPerConfig: number): Promise<{ config_id: string; status: string; latency_ms: number | null; checked_at: string }[]>`（带采样）

- [ ] **Step 1: 写失败测试**

`tests/db/history.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import {
  insertHistory,
  getRecentCheckHistory,
  pruneCheckHistory,
  getCheckHistoryByTime,
} from "@/lib/db/history";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("m1", "openai", "gpt-4o", now, now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("c1", "Cfg1", "openai", "m1", "http://x", "k", "G1", now, now);
  __setDbForTest(db);
  return db;
}

beforeEach(() => seed());

describe("history", () => {
  it("insert 后 getRecentCheckHistory 带 join 字段", async () => {
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 100, ping_latency_ms: 5, checked_at: "2026-06-24T10:00:00.000Z", message: null },
      { config_id: "c1", status: "degraded", latency_ms: 200, ping_latency_ms: 6, checked_at: "2026-06-24T11:00:00.000Z", message: "slow" },
    ]);
    const rows = await getRecentCheckHistory(60, null);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Cfg1");
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].group_name).toBe("G1");
    // DESC：最新在前
    expect(rows[0].checked_at).toBe("2026-06-24T11:00:00.000Z");
  });

  it("limitPerConfig 限制每个 config 条数", async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: `2026-06-24T1${i}:00:00.000Z`, message: null,
    }));
    await insertHistory(recs);
    const rows = await getRecentCheckHistory(3, ["c1"]);
    expect(rows.length).toBe(3);
  });

  it("prune 删除超期记录，返回删除数", async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: old, message: null },
      { config_id: "c1", status: "operational", latency_ms: 2, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const deleted = await pruneCheckHistory(30);
    expect(deleted).toBe(1);
  });

  it("getCheckHistoryByTime 采样保留首尾且不超过上限", async () => {
    const base = Date.now();
    const recs = Array.from({ length: 100 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: new Date(base - (100 - i) * 1000).toISOString(), message: null,
    }));
    await insertHistory(recs);
    const rows = await getCheckHistoryByTime(3600_000, ["c1"], 10);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/history.test.ts`
Expected: FAIL（`@/lib/db/history` 不存在）。

- [ ] **Step 3: 实现 history.ts**

`lib/db/history.ts`：
```ts
import "server-only";
import { getDb } from "./client";
import { nowIso } from "./json";

export type RecentHistoryRow = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
  name: string; type: string; model: string; endpoint: string | null; group_name: string | null;
};
export type HistoryInsert = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
};

export async function insertHistory(records: HistoryInsert[]): Promise<void> {
  if (records.length === 0) return;
  const db = getDb();
  const created = nowIso();
  const stmt = db.prepare(
    `INSERT INTO check_history (config_id,status,latency_ms,ping_latency_ms,checked_at,message,created_at)
     VALUES (@config_id,@status,@latency_ms,@ping_latency_ms,@checked_at,@message,@created_at)`
  );
  const tx = db.transaction((rows: HistoryInsert[]) => {
    for (const r of rows) stmt.run({ ...r, created_at: created });
  });
  tx(records);
}

export async function getRecentCheckHistory(
  limitPerConfig: number,
  targetConfigIds: string[] | null
): Promise<RecentHistoryRow[]> {
  const db = getDb();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `WHERE h.config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const sql = `
    WITH ranked AS (
      SELECT h.config_id, h.status, h.latency_ms, h.ping_latency_ms, h.checked_at, h.message,
             row_number() OVER (PARTITION BY h.config_id ORDER BY h.checked_at DESC) AS rn
      FROM check_history h ${filter}
    )
    SELECT r.config_id, r.status, r.latency_ms, r.ping_latency_ms, r.checked_at, r.message,
           c.name, c.type, m.model, c.endpoint, c.group_name
    FROM ranked r
    JOIN check_configs c ON c.id = r.config_id
    JOIN check_models m ON m.id = c.model_id
    WHERE r.rn <= ?
    ORDER BY c.name ASC, r.checked_at DESC`;
  const params = targetConfigIds && targetConfigIds.length > 0
    ? [...targetConfigIds, limitPerConfig] : [limitPerConfig];
  return db.prepare(sql).all(...params) as RecentHistoryRow[];
}

export async function pruneCheckHistory(retentionDays: number): Promise<number> {
  const db = getDb();
  const effective = Math.min(365, Math.max(7, retentionDays || 30));
  const cutoff = new Date(Date.now() - effective * 86400000).toISOString();
  const info = db.prepare("DELETE FROM check_history WHERE checked_at < ?").run(cutoff);
  return info.changes;
}

export async function getCheckHistoryByTime(
  sinceMs: number,
  targetConfigIds: string[] | null,
  maxPointsPerConfig: number
): Promise<{ config_id: string; status: string; latency_ms: number | null; checked_at: string }[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `AND config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const params = targetConfigIds && targetConfigIds.length > 0 ? [cutoff, ...targetConfigIds] : [cutoff];
  const all = db.prepare(
    `SELECT config_id, status, latency_ms, checked_at FROM check_history
     WHERE checked_at > ? ${filter} ORDER BY config_id, checked_at ASC`
  ).all(...params) as { config_id: string; status: string; latency_ms: number | null; checked_at: string }[];

  const byConfig = new Map<string, typeof all>();
  for (const row of all) {
    const list = byConfig.get(row.config_id);
    if (list) list.push(row); else byConfig.set(row.config_id, [row]);
  }
  const result: typeof all = [];
  for (const list of byConfig.values()) {
    const total = list.length;
    const step = Math.max(1, Math.floor(total / maxPointsPerConfig));
    list.forEach((row, i) => {
      if (i === 0 || i === total - 1 || i % step === 0) result.push(row);
    });
  }
  return result;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/history.test.ts`
Expected: PASS（4 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/history.ts tests/db/history.test.ts
git commit -m "feat(db): 历史读写、最近历史 join、采样与清理"
```

---

### Task 5: db/availability.ts — 可用性统计

**Files:**
- Create: `lib/db/availability.ts`
- Create: `tests/db/availability.test.ts`

**Interfaces:**
- Consumes: `getDb`。
- Produces:
  - `type AvailabilityRow = { config_id: string; period: "7d" | "15d" | "30d"; total_checks: number; operational_count: number; availability_pct: number | null }`
  - `async function getAvailabilityStats(configIds: string[] | null): Promise<AvailabilityRow[]>`（口径：status IN ('operational','degraded') 视为可用）

- [ ] **Step 1: 写失败测试**

`tests/db/availability.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { insertHistory } from "@/lib/db/history";
import { getAvailabilityStats } from "@/lib/db/availability";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)").run("m1","openai","gpt",now,now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("c1","C","openai","m1","http://x","k",now,now);
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("availability", () => {
  it("degraded 计入可用", async () => {
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "degraded", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "failed", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const rows = await getAvailabilityStats(["c1"]);
    const d7 = rows.find((r) => r.period === "7d");
    expect(d7?.total_checks).toBe(3);
    expect(d7?.operational_count).toBe(2);
    expect(d7?.availability_pct).toBeCloseTo(66.67, 1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/availability.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 availability.ts**

`lib/db/availability.ts`：
```ts
import "server-only";
import { getDb } from "./client";

export type AvailabilityRow = {
  config_id: string; period: "7d" | "15d" | "30d";
  total_checks: number; operational_count: number; availability_pct: number | null;
};

const PERIODS: { period: "7d" | "15d" | "30d"; days: number }[] = [
  { period: "7d", days: 7 }, { period: "15d", days: 15 }, { period: "30d", days: 30 },
];

export async function getAvailabilityStats(configIds: string[] | null): Promise<AvailabilityRow[]> {
  const db = getDb();
  const scoped = configIds && configIds.length > 0;
  const filterIds = scoped ? `AND config_id IN (${configIds.map(() => "?").join(",")})` : "";
  const result: AvailabilityRow[] = [];
  for (const { period, days } of PERIODS) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const params = scoped ? [cutoff, ...configIds] : [cutoff];
    const rows = db.prepare(
      `SELECT config_id,
              COUNT(*) AS total_checks,
              SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END) AS operational_count
       FROM check_history
       WHERE checked_at > ? ${filterIds}
       GROUP BY config_id`
    ).all(...params) as { config_id: string; total_checks: number; operational_count: number }[];
    for (const r of rows) {
      result.push({
        config_id: r.config_id,
        period,
        total_checks: r.total_checks,
        operational_count: r.operational_count,
        availability_pct: r.total_checks > 0
          ? Math.round((10000 * r.operational_count) / r.total_checks) / 100
          : null,
      });
    }
  }
  result.sort((a, b) => a.config_id.localeCompare(b.config_id) || a.period.localeCompare(b.period));
  return result;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/availability.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/availability.ts tests/db/availability.test.ts
git commit -m "feat(db): 可用性统计（operational+degraded 口径）"
```

---

### Task 6: db/templates.ts、db/models.ts、db/configs.ts、db/groups.ts、db/notifications.ts

实现 CRUD 数据访问，覆盖 admin 后台与 poller config-loader 所需。每个模块写一组内存库单测后实现。

**Files:**
- Create: `lib/db/templates.ts` · `lib/db/models.ts` · `lib/db/configs.ts` · `lib/db/groups.ts` · `lib/db/notifications.ts`
- Create: `tests/db/configs.test.ts`（覆盖 type 校验 + 级联 + 嵌套加载）、`tests/db/crud.test.ts`（覆盖 templates/models/groups/notifications 基本 CRUD）

**Interfaces:**
- Consumes: `getDb`、`newId`、`nowIso`、`toJson`、`fromJson`、`toBool`、`fromBool`。
- Produces（关键签名，供 Task 7/10 调用点使用）：
  - templates: `listTemplates()`, `getTemplate(id)`, `createTemplate(input)`, `updateTemplate(id,input)`, `deleteTemplate(id)`, `countModelsByTemplate(id)`
  - models: `listModels()`, `getModel(id)`, `createModel(input)`, `updateModel(id,input)`, `deleteModel(id)`, `countConfigsByModel(id)` — create/update **校验** template.type === model.type，不一致抛 `Error("模板类型不匹配")`
  - configs: `listConfigs(scopeGroup?: string|null)`, `getConfig(id)`, `createConfig(input)`, `updateConfig(id,input)`, `deleteConfig(id)`, `setConfigsEnabled(ids,enabled)`, `deleteHistoryByConfig(id)` — create/update **校验** model.type === config.type，不一致抛 `Error("模型类型不匹配")`
  - `loadEnabledConfigsWithModelTemplate(): ConfigWithModelTemplate[]` — 供 config-loader 用，返回含 model.model、template.request_header(JSON 解析后)、template.metadata 的扁平结构
  - groups: `listGroups()`, `getGroupByName(name)`, `createGroup(input)`, `updateGroup(id,input)`, `deleteGroup(id)`
  - notifications: `listNotifications()`, `listActiveNotifications()`, `getNotification(id)`, `createNotification(input)`, `updateNotification(id,input)`, `deleteNotification(id)`

- [ ] **Step 1: 写 configs 失败测试**

`tests/db/configs.test.ts`（关键用例）：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTemplate } from "@/lib/db/templates";
import { createModel } from "@/lib/db/models";
import { createConfig, loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("configs/models type validation", () => {
  it("model.type 与 template.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { a: "1" }, metadata: { x: 1 } });
    await expect(createModel({ type: "anthropic", model: "claude", template_id: tpl.id }))
      .rejects.toThrow("模板类型不匹配");
  });

  it("config.type 与 model.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: null, metadata: null });
    const model = await createModel({ type: "openai", model: "gpt", template_id: tpl.id });
    await expect(createConfig({ name: "c", type: "anthropic", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: null }))
      .rejects.toThrow("模型类型不匹配");
  });

  it("loadEnabledConfigsWithModelTemplate 返回 JSON 解析后的模板", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { Authorization: "Bearer x" }, metadata: { temperature: 0 } });
    const model = await createModel({ type: "openai", model: "gpt-4o", template_id: tpl.id });
    await createConfig({ name: "c", type: "openai", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: "G" });
    const rows = await loadEnabledConfigsWithModelTemplate();
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].request_header).toEqual({ Authorization: "Bearer x" });
    expect(rows[0].metadata).toEqual({ temperature: 0 });
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/configs.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 templates.ts / models.ts / configs.ts**

实现要点（每个 create 用 `newId()`+`nowIso()`，update 重设 `updated_at`，布尔用 `fromBool`/`toBool`，JSON 用 `toJson`/`fromJson`）：
- `models.createModel/updateModel`：写入前 `if (template_id) { 查 template.type; if (!==input.type) throw new Error("模板类型不匹配") }`。
- `configs.createConfig/updateConfig`：写入前查 `check_models.type`，`if (!==input.type) throw new Error("模型类型不匹配")`。
- `loadEnabledConfigsWithModelTemplate`：
```ts
import "server-only";
import { getDb } from "./client";
import { fromJson, toBool } from "./json";

export type ConfigWithModelTemplate = {
  id: string; name: string; type: string; endpoint: string; api_key: string;
  is_maintenance: boolean; group_name: string | null; model: string;
  request_header: Record<string, string> | null; metadata: Record<string, unknown> | null;
};

export async function loadEnabledConfigsWithModelTemplate(): Promise<ConfigWithModelTemplate[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.id,c.name,c.type,c.endpoint,c.api_key,c.is_maintenance,c.group_name,
            m.model AS model, m.type AS model_type,
            t.type AS tpl_type, t.request_header AS request_header, t.metadata AS metadata
     FROM check_configs c
     JOIN check_models m ON m.id = c.model_id
     LEFT JOIN check_request_templates t ON t.id = m.template_id
     WHERE c.enabled = 1
     ORDER BY c.id`
  ).all() as Array<{
    id: string; name: string; type: string; endpoint: string; api_key: string;
    is_maintenance: number; group_name: string | null; model: string; model_type: string;
    tpl_type: string | null; request_header: string | null; metadata: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, endpoint: r.endpoint, api_key: r.api_key,
    is_maintenance: toBool(r.is_maintenance as 0 | 1), group_name: r.group_name,
    model: r.model_type === r.type ? r.model : "",
    request_header: r.tpl_type === r.type ? fromJson<Record<string, string>>(r.request_header) : null,
    metadata: r.tpl_type === r.type ? fromJson<Record<string, unknown>>(r.metadata) : null,
  }));
}
```
（其余 CRUD 按 Interfaces 签名平铺实现，`listConfigs(scopeGroup)` 当 `scopeGroup` 非空时加 `WHERE group_name = ?`。）

- [ ] **Step 4: 实现 groups.ts / notifications.ts + 写 crud 测试**

`tests/db/crud.test.ts` 覆盖：建分组→listGroups 含之；建通知 is_active=true→listActiveNotifications 含之，is_active=false 不含；update 改 updated_at。实现按 Interfaces 签名。

- [ ] **Step 5: 运行全部 db 测试**

Run: `pnpm vitest run tests/db`
Expected: PASS（含 configs.test.ts 3 passed + crud.test.ts 全通过）。

- [ ] **Step 6: 提交**

```bash
git add lib/db tests/db
git commit -m "feat(db): templates/models/configs/groups/notifications CRUD 与类型校验"
```

---

### Task 5: db/availability.ts — 可用性统计

**Files:**
- Create: `lib/db/availability.ts`
- Create: `tests/db/availability.test.ts`

**Interfaces:**
- Consumes: `getDb`。
- Produces:
  - `type AvailabilityRow = { config_id: string; period: "7d" | "15d" | "30d"; total_checks: number; operational_count: number; availability_pct: number | null }`
  - `async function getAvailabilityStats(configIds: string[] | null): Promise<AvailabilityRow[]>`（口径：status IN ('operational','degraded') 视为可用）

- [ ] **Step 1: 写失败测试**

`tests/db/availability.test.ts`：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { insertHistory } from "@/lib/db/history";
import { getAvailabilityStats } from "@/lib/db/availability";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)").run("m1","openai","gpt",now,now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("c1","C","openai","m1","http://x","k",now,now);
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("availability", () => {
  it("degraded 计入可用", async () => {
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "degraded", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "failed", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const rows = await getAvailabilityStats(["c1"]);
    const d7 = rows.find((r) => r.period === "7d");
    expect(d7?.total_checks).toBe(3);
    expect(d7?.operational_count).toBe(2);
    expect(d7?.availability_pct).toBeCloseTo(66.67, 1);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/availability.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 availability.ts**

`lib/db/availability.ts`：
```ts
import "server-only";
import { getDb } from "./client";

export type AvailabilityRow = {
  config_id: string; period: "7d" | "15d" | "30d";
  total_checks: number; operational_count: number; availability_pct: number | null;
};

const PERIODS: { period: "7d" | "15d" | "30d"; days: number }[] = [
  { period: "7d", days: 7 }, { period: "15d", days: 15 }, { period: "30d", days: 30 },
];

export async function getAvailabilityStats(configIds: string[] | null): Promise<AvailabilityRow[]> {
  const db = getDb();
  const scoped = configIds && configIds.length > 0;
  const filterIds = scoped ? `AND config_id IN (${configIds.map(() => "?").join(",")})` : "";
  const result: AvailabilityRow[] = [];
  for (const { period, days } of PERIODS) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const params = scoped ? [cutoff, ...configIds] : [cutoff];
    const rows = db.prepare(
      `SELECT config_id,
              COUNT(*) AS total_checks,
              SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END) AS operational_count
       FROM check_history
       WHERE checked_at > ? ${filterIds}
       GROUP BY config_id`
    ).all(...params) as { config_id: string; total_checks: number; operational_count: number }[];
    for (const r of rows) {
      result.push({
        config_id: r.config_id,
        period,
        total_checks: r.total_checks,
        operational_count: r.operational_count,
        availability_pct: r.total_checks > 0
          ? Math.round((10000 * r.operational_count) / r.total_checks) / 100
          : null,
      });
    }
  }
  result.sort((a, b) => a.config_id.localeCompare(b.config_id) || a.period.localeCompare(b.period));
  return result;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `pnpm vitest run tests/db/availability.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 5: 提交**

```bash
git add lib/db/availability.ts tests/db/availability.test.ts
git commit -m "feat(db): 可用性统计（operational+degraded 口径）"
```

---

### Task 6: db/templates.ts、db/models.ts、db/configs.ts、db/groups.ts、db/notifications.ts

实现 CRUD 数据访问，覆盖 admin 后台与 poller config-loader 所需。每个模块写一组内存库单测后实现。

**Files:**
- Create: `lib/db/templates.ts` · `lib/db/models.ts` · `lib/db/configs.ts` · `lib/db/groups.ts` · `lib/db/notifications.ts`
- Create: `tests/db/configs.test.ts`（覆盖 type 校验 + 级联 + 嵌套加载）、`tests/db/crud.test.ts`（覆盖 templates/models/groups/notifications 基本 CRUD）

**Interfaces:**
- Consumes: `getDb`、`newId`、`nowIso`、`toJson`、`fromJson`、`toBool`、`fromBool`。
- Produces（关键签名，供 Task 7/10 调用点使用）：
  - templates: `listTemplates()`, `getTemplate(id)`, `createTemplate(input)`, `updateTemplate(id,input)`, `deleteTemplate(id)`, `countModelsByTemplate(id)`
  - models: `listModels()`, `getModel(id)`, `createModel(input)`, `updateModel(id,input)`, `deleteModel(id)`, `countConfigsByModel(id)` — create/update **校验** template.type === model.type，不一致抛 `Error("模板类型不匹配")`
  - configs: `listConfigs(scopeGroup?: string|null)`, `getConfig(id)`, `createConfig(input)`, `updateConfig(id,input)`, `deleteConfig(id)`, `setConfigsEnabled(ids,enabled)`, `deleteHistoryByConfig(id)` — create/update **校验** model.type === config.type，不一致抛 `Error("模型类型不匹配")`
  - `loadEnabledConfigsWithModelTemplate(): ConfigWithModelTemplate[]` — 供 config-loader 用，返回含 model.model、template.request_header(JSON 解析后)、template.metadata 的扁平结构
  - groups: `listGroups()`, `getGroupByName(name)`, `createGroup(input)`, `updateGroup(id,input)`, `deleteGroup(id)`
  - notifications: `listNotifications()`, `listActiveNotifications()`, `getNotification(id)`, `createNotification(input)`, `updateNotification(id,input)`, `deleteNotification(id)`

- [ ] **Step 1: 写 configs 失败测试**

`tests/db/configs.test.ts`（关键用例）：
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTemplate } from "@/lib/db/templates";
import { createModel } from "@/lib/db/models";
import { createConfig, loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("configs/models type validation", () => {
  it("model.type 与 template.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { a: "1" }, metadata: { x: 1 } });
    await expect(createModel({ type: "anthropic", model: "claude", template_id: tpl.id }))
      .rejects.toThrow("模板类型不匹配");
  });

  it("config.type 与 model.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: null, metadata: null });
    const model = await createModel({ type: "openai", model: "gpt", template_id: tpl.id });
    await expect(createConfig({ name: "c", type: "anthropic", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: null }))
      .rejects.toThrow("模型类型不匹配");
  });

  it("loadEnabledConfigsWithModelTemplate 返回 JSON 解析后的模板", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { Authorization: "Bearer x" }, metadata: { temperature: 0 } });
    const model = await createModel({ type: "openai", model: "gpt-4o", template_id: tpl.id });
    await createConfig({ name: "c", type: "openai", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: "G" });
    const rows = await loadEnabledConfigsWithModelTemplate();
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].request_header).toEqual({ Authorization: "Bearer x" });
    expect(rows[0].metadata).toEqual({ temperature: 0 });
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm vitest run tests/db/configs.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 templates.ts / models.ts / configs.ts**

实现要点（每个 create 用 `newId()`+`nowIso()`，update 重设 `updated_at`，布尔用 `fromBool`/`toBool`，JSON 用 `toJson`/`fromJson`）：
- `models.createModel/updateModel`：写入前 `if (template_id) { 查 template.type; if (!==input.type) throw new Error("模板类型不匹配") }`。
- `configs.createConfig/updateConfig`：写入前查 `check_models.type`，`if (!==input.type) throw new Error("模型类型不匹配")`。
- `loadEnabledConfigsWithModelTemplate`：
```ts
import "server-only";
import { getDb } from "./client";
import { fromJson, toBool } from "./json";

export type ConfigWithModelTemplate = {
  id: string; name: string; type: string; endpoint: string; api_key: string;
  is_maintenance: boolean; group_name: string | null; model: string;
  request_header: Record<string, string> | null; metadata: Record<string, unknown> | null;
};

export async function loadEnabledConfigsWithModelTemplate(): Promise<ConfigWithModelTemplate[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.id,c.name,c.type,c.endpoint,c.api_key,c.is_maintenance,c.group_name,
            m.model AS model, m.type AS model_type,
            t.type AS tpl_type, t.request_header AS request_header, t.metadata AS metadata
     FROM check_configs c
     JOIN check_models m ON m.id = c.model_id
     LEFT JOIN check_request_templates t ON t.id = m.template_id
     WHERE c.enabled = 1
     ORDER BY c.id`
  ).all() as Array<{
    id: string; name: string; type: string; endpoint: string; api_key: string;
    is_maintenance: number; group_name: string | null; model: string; model_type: string;
    tpl_type: string | null; request_header: string | null; metadata: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, endpoint: r.endpoint, api_key: r.api_key,
    is_maintenance: toBool(r.is_maintenance as 0 | 1), group_name: r.group_name,
    model: r.model_type === r.type ? r.model : "",
    request_header: r.tpl_type === r.type ? fromJson<Record<string, string>>(r.request_header) : null,
    metadata: r.tpl_type === r.type ? fromJson<Record<string, unknown>>(r.metadata) : null,
  }));
}
```
（其余 CRUD 按 Interfaces 签名平铺实现，`listConfigs(scopeGroup)` 当 `scopeGroup` 非空时加 `WHERE group_name = ?`。）

- [ ] **Step 4: 实现 groups.ts / notifications.ts + 写 crud 测试**

`tests/db/crud.test.ts` 覆盖：建分组→listGroups 含之；建通知 is_active=true→listActiveNotifications 含之，is_active=false 不含；update 改 updated_at。实现按 Interfaces 签名。

- [ ] **Step 5: 运行全部 db 测试**

Run: `pnpm vitest run tests/db`
Expected: PASS（含 configs.test.ts 3 passed + crud.test.ts 全通过）。

- [ ] **Step 6: 提交**

```bash
git add lib/db tests/db
git commit -m "feat(db): templates/models/configs/groups/notifications CRUD 与类型校验"
```

---

### Task 7: 替换 check-cx 数据访问调用点

把基底 `lib/database/*` 与 `lib/core/*` 中所有 supabase 调用改走 `lib/db/*`。

**Files:**
- Modify: `lib/database/config-loader.ts`、`lib/database/history.ts`、`lib/database/availability.ts`、`lib/database/group-info.ts`、`lib/database/notifications.ts`
- Delete: `lib/supabase/admin.ts`、`lib/supabase/server.ts`、`lib/supabase/middleware.ts`
- Test: `tests/integration/check-cx-data.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 的 `lib/db/*` 函数。
- Produces: 上述模块对外导出的函数签名**保持不变**（`loadProviderConfigsFromDB`、`historySnapshotStore`/`loadHistory`/`appendHistory`、`getAvailabilityStats`、`loadGroupInfos`/`getGroupInfo`、通知导出函数），仅内部实现切到 SQLite。

- [ ] **Step 1: 改 config-loader.ts**

把 `createAdminClient()` + `.from("check_configs").select(...)` 整段替换为调用 `loadEnabledConfigsWithModelTemplate()`，再映射成 `ProviderConfig`：
```ts
import { loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";
// ...在 loadProviderConfigsFromDB 内：
const rows = await loadEnabledConfigsWithModelTemplate();
const configs: ProviderConfig[] = rows.map((r) => ({
  id: r.id, name: r.name, type: r.type as ProviderType, endpoint: r.endpoint,
  model: r.model, apiKey: r.api_key, is_maintenance: r.is_maintenance,
  requestHeaders: r.request_header, metadata: r.metadata, groupName: r.group_name || null,
}));
```
删除 `import {createAdminClient} from "../supabase/admin"` 及 supabase 查询代码、`getModel`/`getTemplateFromModel`/`normalizeJsonRecord`（解析已移入 db 层）。保留 cache/metrics 逻辑。

- [ ] **Step 2: 改 history.ts**

`SnapshotStore.fetch` → 调用 `getRecentCheckHistory(limitPerConfig, normalizedIds)`，用现有 `mapRowsToSnapshot` 把行转 `HistorySnapshot`（字段名一致：config_id/status/latency_ms/ping_latency_ms/checked_at/message/name/type/model/endpoint/group_name）。`append` → `insertHistory(records)` 后 `pruneInternal`。`pruneInternal` → `pruneCheckHistory(retentionDays)`。删除 `RPC_*` 常量、`fallback*` 函数、`isMissingFunctionError`、`PostgrestError` import、`createAdminClient` import。

- [ ] **Step 3: 改 availability.ts / group-info.ts / notifications.ts**

- availability.ts：`.from("availability_stats").select()` → `getAvailabilityStats(normalizedIds)`，用现有 `mapRows` 转 map（行字段一致）。
- group-info.ts：`.from("group_info").select()` → `listGroups()`（返回 GroupInfoRow[]，已含 tags 默认 ''）。
- notifications.ts：`.from("system_notifications").select().eq("is_active", true)` → `listActiveNotifications()`。
- 三个文件均删除 `createAdminClient` import。

- [ ] **Step 4: 删除 lib/supabase 目录**

```bash
git rm lib/supabase/admin.ts lib/supabase/server.ts lib/supabase/middleware.ts
```

- [ ] **Step 5: 写集成测试**

`tests/integration/check-cx-data.test.ts`：内存库 seed（template+model+config+history），注入 `__setDbForTest`，调用 `loadProviderConfigsFromDB({forceRefresh:true})` 断言返回 1 条且 `requestHeaders`/`model` 正确；调用 `loadHistory()` 断言快照含该 config。

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `pnpm vitest run tests/integration/check-cx-data.test.ts && pnpm exec tsc --noEmit`
Expected: 测试 PASS；tsc 无 supabase 相关报错（poller-lease 仍引用，下一 Task 处理，可暂用 `git stash` 范围或允许该文件暂时报错——实际按顺序执行时 Task 8 紧接修复）。

- [ ] **Step 7: 提交**

```bash
git add lib/database lib/core tests/integration
git rm -r --cached lib/supabase 2>/dev/null; true
git commit -m "refactor(check-cx): 数据访问切换到 SQLite，移除 lib/supabase"
```

---

### Task 8: 轮询器去租约，改进程内单例

**Files:**
- Modify: `lib/core/poller.ts`、`lib/core/global-state.ts`
- Delete: `lib/core/poller-leadership.ts`、`lib/database/poller-lease.ts`
- Test: `tests/integration/poller-guard.test.ts`

**Interfaces:**
- Consumes: `isPollerRunning()`、`setPollerRunning(b)`（global-state 已有）。
- Produces: `poller.ts` 启动入口保证单进程只初始化一次；不再 import leadership/lease。

- [ ] **Step 1: 删除租约文件**

```bash
git rm lib/core/poller-leadership.ts lib/database/poller-lease.ts
```

- [ ] **Step 2: 改 poller.ts**

删除 `import {ensurePollerLeadership, isPollerLeader} from "./poller-leadership"`。把模块初始化处的 leader 判断改为进程内单例守卫：启动入口先 `if (isPollerRunning()) return; setPollerRunning(true);` 再启动定时器与官方状态轮询。原先依赖 `isPollerLeader()` 才执行检测的分支，去掉条件直接执行。

- [ ] **Step 3: 清理 global-state.ts**

删除 `PollerRole` 类型、`__checkCxPollerLeaderTimer`/`__checkCxPollerRole` 声明、`getPollerLeaderTimer`/`setPollerLeaderTimer`/`getPollerRole`/`setPollerRole`。保留 `isPollerRunning`/`setPollerRunning`/`getPollerTimer`/`setPollerTimer`/ping 相关。

- [ ] **Step 4: 写守卫测试**

`tests/integration/poller-guard.test.ts`：mock global-state，断言连续两次调用启动入口时第二次因 `isPollerRunning()` 为 true 而不再注册定时器（用计数器或 spy 验证只初始化一次）。

- [ ] **Step 5: 运行 + 类型检查**

Run: `pnpm vitest run tests/integration/poller-guard.test.ts && pnpm exec tsc --noEmit`
Expected: PASS；tsc 无报错（lease/leadership 引用已清除）。

- [ ] **Step 6: 提交**

```bash
git add lib/core tests/integration
git commit -m "refactor(poller): 移除多节点租约，改进程内单例守卫"
```

---

### Task 7: 替换 check-cx 数据访问调用点

把基底 `lib/database/*` 与 `lib/core/*` 中所有 supabase 调用改走 `lib/db/*`。

**Files:**
- Modify: `lib/database/config-loader.ts`、`lib/database/history.ts`、`lib/database/availability.ts`、`lib/database/group-info.ts`、`lib/database/notifications.ts`
- Delete: `lib/supabase/admin.ts`、`lib/supabase/server.ts`、`lib/supabase/middleware.ts`
- Test: `tests/integration/check-cx-data.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 的 `lib/db/*` 函数。
- Produces: 上述模块对外导出的函数签名**保持不变**（`loadProviderConfigsFromDB`、`historySnapshotStore`/`loadHistory`/`appendHistory`、`getAvailabilityStats`、`loadGroupInfos`/`getGroupInfo`、通知导出函数），仅内部实现切到 SQLite。

- [ ] **Step 1: 改 config-loader.ts**

把 `createAdminClient()` + `.from("check_configs").select(...)` 整段替换为调用 `loadEnabledConfigsWithModelTemplate()`，再映射成 `ProviderConfig`：
```ts
import { loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";
// ...在 loadProviderConfigsFromDB 内：
const rows = await loadEnabledConfigsWithModelTemplate();
const configs: ProviderConfig[] = rows.map((r) => ({
  id: r.id, name: r.name, type: r.type as ProviderType, endpoint: r.endpoint,
  model: r.model, apiKey: r.api_key, is_maintenance: r.is_maintenance,
  requestHeaders: r.request_header, metadata: r.metadata, groupName: r.group_name || null,
}));
```
删除 `import {createAdminClient} from "../supabase/admin"` 及 supabase 查询代码、`getModel`/`getTemplateFromModel`/`normalizeJsonRecord`（解析已移入 db 层）。保留 cache/metrics 逻辑。

- [ ] **Step 2: 改 history.ts**

`SnapshotStore.fetch` → 调用 `getRecentCheckHistory(limitPerConfig, normalizedIds)`，用现有 `mapRowsToSnapshot` 把行转 `HistorySnapshot`（字段名一致：config_id/status/latency_ms/ping_latency_ms/checked_at/message/name/type/model/endpoint/group_name）。`append` → `insertHistory(records)` 后 `pruneInternal`。`pruneInternal` → `pruneCheckHistory(retentionDays)`。删除 `RPC_*` 常量、`fallback*` 函数、`isMissingFunctionError`、`PostgrestError` import、`createAdminClient` import。

- [ ] **Step 3: 改 availability.ts / group-info.ts / notifications.ts**

- availability.ts：`.from("availability_stats").select()` → `getAvailabilityStats(normalizedIds)`，用现有 `mapRows` 转 map（行字段一致）。
- group-info.ts：`.from("group_info").select()` → `listGroups()`（返回 GroupInfoRow[]，已含 tags 默认 ''）。
- notifications.ts：`.from("system_notifications").select().eq("is_active", true)` → `listActiveNotifications()`。
- 三个文件均删除 `createAdminClient` import。

- [ ] **Step 4: 删除 lib/supabase 目录**

```bash
git rm lib/supabase/admin.ts lib/supabase/server.ts lib/supabase/middleware.ts
```

- [ ] **Step 5: 写集成测试**

`tests/integration/check-cx-data.test.ts`：内存库 seed（template+model+config+history），注入 `__setDbForTest`，调用 `loadProviderConfigsFromDB({forceRefresh:true})` 断言返回 1 条且 `requestHeaders`/`model` 正确；调用 `loadHistory()` 断言快照含该 config。

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `pnpm vitest run tests/integration/check-cx-data.test.ts && pnpm exec tsc --noEmit`
Expected: 测试 PASS；tsc 无 supabase 相关报错（poller-lease 仍引用，下一 Task 处理，可暂用 `git stash` 范围或允许该文件暂时报错——实际按顺序执行时 Task 8 紧接修复）。

- [ ] **Step 7: 提交**

```bash
git add lib/database lib/core tests/integration
git rm -r --cached lib/supabase 2>/dev/null; true
git commit -m "refactor(check-cx): 数据访问切换到 SQLite，移除 lib/supabase"
```

---

### Task 8: 轮询器去租约，改进程内单例

**Files:**
- Modify: `lib/core/poller.ts`、`lib/core/global-state.ts`
- Delete: `lib/core/poller-leadership.ts`、`lib/database/poller-lease.ts`
- Test: `tests/integration/poller-guard.test.ts`

**Interfaces:**
- Consumes: `isPollerRunning()`、`setPollerRunning(b)`（global-state 已有）。
- Produces: `poller.ts` 启动入口保证单进程只初始化一次；不再 import leadership/lease。

- [ ] **Step 1: 删除租约文件**

```bash
git rm lib/core/poller-leadership.ts lib/database/poller-lease.ts
```

- [ ] **Step 2: 改 poller.ts**

删除 `import {ensurePollerLeadership, isPollerLeader} from "./poller-leadership"`。把模块初始化处的 leader 判断改为进程内单例守卫：启动入口先 `if (isPollerRunning()) return; setPollerRunning(true);` 再启动定时器与官方状态轮询。原先依赖 `isPollerLeader()` 才执行检测的分支，去掉条件直接执行。

- [ ] **Step 3: 清理 global-state.ts**

删除 `PollerRole` 类型、`__checkCxPollerLeaderTimer`/`__checkCxPollerRole` 声明、`getPollerLeaderTimer`/`setPollerLeaderTimer`/`getPollerRole`/`setPollerRole`。保留 `isPollerRunning`/`setPollerRunning`/`getPollerTimer`/`setPollerTimer`/ping 相关。

- [ ] **Step 4: 写守卫测试**

`tests/integration/poller-guard.test.ts`：mock global-state，断言连续两次调用启动入口时第二次因 `isPollerRunning()` 为 true 而不再注册定时器（用计数器或 spy 验证只初始化一次）。

- [ ] **Step 5: 运行 + 类型检查**

Run: `pnpm vitest run tests/integration/poller-guard.test.ts && pnpm exec tsc --noEmit`
Expected: PASS；tsc 无报错（lease/leadership 引用已清除）。

- [ ] **Step 6: 提交**

```bash
git add lib/core tests/integration
git commit -m "refactor(poller): 移除多节点租约，改进程内单例守卫"
```

---

### Task 9: 迁入 admin 静态资源（页面/组件/hooks/样式）

把 admin 的 UI 与业务代码拷入统一应用，挂在 `/admin/*`，先不接数据层（下一 Task 接）。

**Files:**
- Create: `app/admin/**`（来自 `check-cx-admin/app/dashboard/**`）、`app/admin/login/page.tsx`（来自 `app/login/page.tsx`）、`app/auth/**`
- Create: `components/admin/**`、`hooks/**`（来自 admin）
- Create: `lib/admin/**`（来自 admin，**排除** `supabase-admin.ts`、`server-env.ts` 中 supabase 部分）

**Interfaces:**
- Produces: `/admin/*` 路由树可编译（数据调用暂用占位，下一 Task 替换）。

- [ ] **Step 1: 拷贝目录**

```powershell
$src="E:\Prod_Project\other\Monitor_Platform\check-cx-admin"
$dst="E:\Prod_Project\other\Monitor_Platform"
Copy-Item "$src\app\dashboard" "$dst\app\admin" -Recurse -Force
Copy-Item "$src\app\login" "$dst\app\admin\login" -Recurse -Force
Copy-Item "$src\app\auth" "$dst\app\auth" -Recurse -Force
Copy-Item "$src\components\admin" "$dst\components\admin" -Recurse -Force
Copy-Item "$src\hooks" "$dst\hooks" -Recurse -Force
Copy-Item "$src\lib\admin" "$dst\lib\admin" -Recurse -Force
```

- [ ] **Step 2: 删除 admin 的 supabase 依赖文件**

```bash
git rm lib/admin/supabase-admin.ts 2>/dev/null; true
rm -f lib/admin/supabase-admin.ts
```
`lib/admin/server-env.ts`：删除 `getServerSupabaseUrl`/`getServerSupabasePublicKey`/`getServiceRoleKey`/`getAdminDatabaseSchema`/`hasAdminDatabaseEnv`/`getAdminDatabaseWarnings`/`normalizeSchemaName` 等 supabase 相关导出；若清空则整文件删除，引用处改为不再校验 DB env。

- [ ] **Step 3: 修正登录/登出重定向路径到 /admin**

admin 原登录成功跳 `/dashboard`，改为 `/admin`。检查 `app/auth/sign-in/password/route.ts` 与 `lib/admin/env.ts` 的 `sanitizeRedirectPath` 默认值 `/dashboard` → `/admin`。登录页 `app/admin/login/page.tsx` 表单 action 指向 `/auth/sign-in/password`（保持）。

- [ ] **Step 4: 解决组件/类型重复**

`components/ui/*` 两项目都有；以基底（check-cx）为准，admin 缺的组件补入。`lib/types` 合并 admin 的类型到基底 `lib/types`（如 `provider.ts`/`database.ts` 已覆盖则跳过；admin 独有的 `AppUser`/`AdminUser` 等放入 `lib/admin/types.ts` 保留）。`lib/utils.ts`（admin）合并进基底 `lib/utils/`。

- [ ] **Step 5: 编译检查（容忍数据层占位报错）**

Run: `pnpm exec tsc --noEmit`
Expected: 仅 `lib/admin/queries.ts` 与 `app/admin/**/actions.ts` 因仍引用已删的 `supabase-admin` 报错——这些在 Task 10 修复。其余无报错。

- [ ] **Step 6: 提交**

```bash
git add app/admin app/auth components/admin hooks lib/admin lib/types lib/utils
git commit -m "feat(admin): 迁入后台页面/组件/hooks 到 /admin（数据层待接）"
```

---

### Task 10: 替换 admin 数据访问到 SQLite

把 `lib/admin/queries.ts` 与各 `app/admin/**/actions.ts` 的 supabase 调用改走 `lib/db/*`。

**Files:**
- Modify: `lib/admin/queries.ts`、`app/admin/configs/actions.ts`、`app/admin/models/actions.ts`、`app/admin/templates/actions.ts`、`app/admin/groups/actions.ts`、`app/admin/notifications/actions.ts`、`app/admin/users/actions.ts`、`app/admin/system/page.tsx`
- Test: `tests/integration/admin-data.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `lib/db/configs|models|templates|groups|notifications` 函数 + Task 4/5 的 history/availability。
- Produces: 后台查询/写入函数签名对页面保持不变；移除所有 `createAdminClient`。

- [ ] **Step 1: 改 queries.ts 读路径**

逐个替换：`countRows`→对应 `count*`/`list*().length`；`listConfigs`→`lib/db/configs.listConfigs(scopeGroup)`；models/templates/groups/notifications 的 list/get→对应 db 函数；`listRecentHistory`→`getRecentCheckHistory(limit, scopedIds)` 后映射成 `CheckHistoryRecord`；`listAvailabilityStats`→`getAvailabilityStats(scopedIds)`；删除 `getPollerLease`（租约已移除）。`applyConfigScope`/`listScopedConfigIds` 改用 db 层 `listConfigs(groupName)` 推导。

- [ ] **Step 2: 改各 actions.ts 写路径**

`configs/actions.ts`：`insert/update/delete/enable/disable` → `createConfig/updateConfig/deleteConfig/setConfigsEnabled`；`from("check_history").delete().eq("config_id",id)` → `deleteHistoryByConfig(id)`。models/templates/groups/notifications 的 actions 同理换成对应 db 函数。所有 `const {error}=await client...` 改 `try/catch`（db 函数失败抛错）。删除 `createAdminClient` import。

- [ ] **Step 3: 改 system/page.tsx**

移除轮询租约卡片（`getPollerLease`），或改展示运行态文案"轮询器：进程内单实例运行"。移除 DB env 警告（supabase 相关）。

- [ ] **Step 4: 写集成测试**

`tests/integration/admin-data.test.ts`：内存库注入，覆盖 admin 关键链路——创建模板→模型→配置（经 queries/actions 暴露的函数）后 `listConfigs()` 含之；`setConfigsEnabled([id], false)` 后该 config `enabled=0`；`deleteConfig` 级联删除其 history。

- [ ] **Step 5: 运行测试 + 全量类型检查**

Run: `pnpm vitest run && pnpm exec tsc --noEmit`
Expected: 全部 PASS；tsc 无报错（已无 supabase 引用）。

- [ ] **Step 6: 提交**

```bash
git add lib/admin app/admin tests/integration
git commit -m "refactor(admin): 后台数据访问切换到 SQLite"
```

---

### Task 9: 迁入 admin 静态资源（页面/组件/hooks/样式）

把 admin 的 UI 与业务代码拷入统一应用，挂在 `/admin/*`，先不接数据层（下一 Task 接）。

**Files:**
- Create: `app/admin/**`（来自 `check-cx-admin/app/dashboard/**`）、`app/admin/login/page.tsx`（来自 `app/login/page.tsx`）、`app/auth/**`
- Create: `components/admin/**`、`hooks/**`（来自 admin）
- Create: `lib/admin/**`（来自 admin，**排除** `supabase-admin.ts`、`server-env.ts` 中 supabase 部分）

**Interfaces:**
- Produces: `/admin/*` 路由树可编译（数据调用暂用占位，下一 Task 替换）。

- [ ] **Step 1: 拷贝目录**

```powershell
$src="E:\Prod_Project\other\Monitor_Platform\check-cx-admin"
$dst="E:\Prod_Project\other\Monitor_Platform"
Copy-Item "$src\app\dashboard" "$dst\app\admin" -Recurse -Force
Copy-Item "$src\app\login" "$dst\app\admin\login" -Recurse -Force
Copy-Item "$src\app\auth" "$dst\app\auth" -Recurse -Force
Copy-Item "$src\components\admin" "$dst\components\admin" -Recurse -Force
Copy-Item "$src\hooks" "$dst\hooks" -Recurse -Force
Copy-Item "$src\lib\admin" "$dst\lib\admin" -Recurse -Force
```

- [ ] **Step 2: 删除 admin 的 supabase 依赖文件**

```bash
git rm lib/admin/supabase-admin.ts 2>/dev/null; true
rm -f lib/admin/supabase-admin.ts
```
`lib/admin/server-env.ts`：删除 `getServerSupabaseUrl`/`getServerSupabasePublicKey`/`getServiceRoleKey`/`getAdminDatabaseSchema`/`hasAdminDatabaseEnv`/`getAdminDatabaseWarnings`/`normalizeSchemaName` 等 supabase 相关导出；若清空则整文件删除，引用处改为不再校验 DB env。

- [ ] **Step 3: 修正登录/登出重定向路径到 /admin**

admin 原登录成功跳 `/dashboard`，改为 `/admin`。检查 `app/auth/sign-in/password/route.ts` 与 `lib/admin/env.ts` 的 `sanitizeRedirectPath` 默认值 `/dashboard` → `/admin`。登录页 `app/admin/login/page.tsx` 表单 action 指向 `/auth/sign-in/password`（保持）。

- [ ] **Step 4: 解决组件/类型重复**

`components/ui/*` 两项目都有；以基底（check-cx）为准，admin 缺的组件补入。`lib/types` 合并 admin 的类型到基底 `lib/types`（如 `provider.ts`/`database.ts` 已覆盖则跳过；admin 独有的 `AppUser`/`AdminUser` 等放入 `lib/admin/types.ts` 保留）。`lib/utils.ts`（admin）合并进基底 `lib/utils/`。

- [ ] **Step 5: 编译检查（容忍数据层占位报错）**

Run: `pnpm exec tsc --noEmit`
Expected: 仅 `lib/admin/queries.ts` 与 `app/admin/**/actions.ts` 因仍引用已删的 `supabase-admin` 报错——这些在 Task 10 修复。其余无报错。

- [ ] **Step 6: 提交**

```bash
git add app/admin app/auth components/admin hooks lib/admin lib/types lib/utils
git commit -m "feat(admin): 迁入后台页面/组件/hooks 到 /admin（数据层待接）"
```

---

### Task 10: 替换 admin 数据访问到 SQLite

把 `lib/admin/queries.ts` 与各 `app/admin/**/actions.ts` 的 supabase 调用改走 `lib/db/*`。

**Files:**
- Modify: `lib/admin/queries.ts`、`app/admin/configs/actions.ts`、`app/admin/models/actions.ts`、`app/admin/templates/actions.ts`、`app/admin/groups/actions.ts`、`app/admin/notifications/actions.ts`、`app/admin/users/actions.ts`、`app/admin/system/page.tsx`
- Test: `tests/integration/admin-data.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `lib/db/configs|models|templates|groups|notifications` 函数 + Task 4/5 的 history/availability。
- Produces: 后台查询/写入函数签名对页面保持不变；移除所有 `createAdminClient`。

- [ ] **Step 1: 改 queries.ts 读路径**

逐个替换：`countRows`→对应 `count*`/`list*().length`；`listConfigs`→`lib/db/configs.listConfigs(scopeGroup)`；models/templates/groups/notifications 的 list/get→对应 db 函数；`listRecentHistory`→`getRecentCheckHistory(limit, scopedIds)` 后映射成 `CheckHistoryRecord`；`listAvailabilityStats`→`getAvailabilityStats(scopedIds)`；删除 `getPollerLease`（租约已移除）。`applyConfigScope`/`listScopedConfigIds` 改用 db 层 `listConfigs(groupName)` 推导。

- [ ] **Step 2: 改各 actions.ts 写路径**

`configs/actions.ts`：`insert/update/delete/enable/disable` → `createConfig/updateConfig/deleteConfig/setConfigsEnabled`；`from("check_history").delete().eq("config_id",id)` → `deleteHistoryByConfig(id)`。models/templates/groups/notifications 的 actions 同理换成对应 db 函数。所有 `const {error}=await client...` 改 `try/catch`（db 函数失败抛错）。删除 `createAdminClient` import。

- [ ] **Step 3: 改 system/page.tsx**

移除轮询租约卡片（`getPollerLease`），或改展示运行态文案"轮询器：进程内单实例运行"。移除 DB env 警告（supabase 相关）。

- [ ] **Step 4: 写集成测试**

`tests/integration/admin-data.test.ts`：内存库注入，覆盖 admin 关键链路——创建模板→模型→配置（经 queries/actions 暴露的函数）后 `listConfigs()` 含之；`setConfigsEnabled([id], false)` 后该 config `enabled=0`；`deleteConfig` 级联删除其 history。

- [ ] **Step 5: 运行测试 + 全量类型检查**

Run: `pnpm vitest run && pnpm exec tsc --noEmit`
Expected: 全部 PASS；tsc 无报错（已无 supabase 引用）。

- [ ] **Step 6: 提交**

```bash
git add lib/admin app/admin tests/integration
git commit -m "refactor(admin): 后台数据访问切换到 SQLite"
```

---

### Task 11: 中间件、初始化与公开 API 收尾

**Files:**
- Create: `middleware.ts`（根）
- Modify: `instrumentation.ts`、`app/(public)` 路由分组、`app/api/**`
- Delete: `check-cx-admin/proxy.ts` 的等价引用（不拷入）

**Interfaces:**
- Consumes: `verifySessionToken`、`SESSION_COOKIE_NAME`、`hasAdminAuthEnv`（`lib/admin/session.ts`）；`runMigrations`（Task 2）。
- Produces: `/admin/*` 受保护；公开路由放行；启动建表 + 拉起轮询器。

- [ ] **Step 1: 建根 middleware.ts**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, hasAdminAuthEnv, verifySessionToken } from "@/lib/admin/session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  if (!hasAdminAuthEnv()) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 2: 组织 public route group**

把基底的 `app/page.tsx`、`app/group/`、`app/not-found.tsx`、面板专用 `layout` 移入 `app/(public)/`（route group 不影响 URL）。确认 `app/layout.tsx` 作为根布局保留。公开 API `app/api/dashboard|group|v1/status|notifications|internal` 保持原路径。

- [ ] **Step 3: 启动建表**

`instrumentation.ts` 改为：
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("@/lib/db/migrate");
    runMigrations();
    await import("@/lib/core/poller");
  }
}
```

- [ ] **Step 4: 创建 data 目录占位**

```bash
mkdir -p data && printf "*\n!.gitkeep\n" > data/.gitignore && touch data/.gitkeep
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add middleware.ts instrumentation.ts app data
git commit -m "feat: /admin 中间件保护、启动建表、public route group"
```

---

### Task 12: 配置、Docker 与最终验证

**Files:**
- Modify: `.env`、`Dockerfile`、`docker-compose.yml`、`next.config.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: 可 `pnpm build` 的生产构建 + 可运行容器。

- [ ] **Step 1: 写 .env（本地）**

按 `.env.example` 生成 `.env`，填入随机 `ADMIN_LOGIN_KEY`、`ADMIN_SESSION_SECRET`（≥32 字节）。确认无任何 `SUPABASE_*`、`CHECK_NODE_ID`。

- [ ] **Step 2: 改 Dockerfile**

基底 Dockerfile 构建阶段加原生编译工具链（Alpine）：
```dockerfile
RUN apk add --no-cache python3 make g++
```
确保 `data/` 不被 COPY 覆盖；`output: "standalone"` 时把 `lib/db/schema.sql` 一并复制进运行镜像（standalone 不自动带非 JS 资源）：
```dockerfile
COPY --from=builder /app/lib/db/schema.sql ./lib/db/schema.sql
```

- [ ] **Step 3: 改 docker-compose.yml**

单服务，挂载持久卷：
```yaml
services:
  monitor:
    build: .
    ports: ["3000:3000"]
    env_file: [.env]
    volumes: ["./data:/app/data"]
    restart: unless-stopped
```

- [ ] **Step 4: 全量测试**

Run: `pnpm vitest run`
Expected: 全部 PASS。

- [ ] **Step 5: 生产构建**

Run: `pnpm build`
Expected: 构建成功，无 supabase 模块解析错误，无类型错误。

- [ ] **Step 6: 冒烟验证**

Run: `pnpm start`（另开终端），然后：
- 访问 `http://localhost:3000/` → 公开面板加载（空数据库时为空列表，无报错）。
- 访问 `http://localhost:3000/admin` → 重定向 `/admin/login`。
- 用 `ADMIN_LOGIN_KEY` 登录 → 进入 `/admin`，新建一个 template→model→config，确认列表出现。
- 等待一个轮询周期，`/admin/history` 或公开面板出现检测记录。
- `data/monitor.db` 文件已生成。

- [ ] **Step 7: 更新 README + 提交**

README 写明：单应用架构、SQLite 路径与持久化、`ADMIN_LOGIN_KEY` 登录、轮询单实例限制。
```bash
git add .env.example Dockerfile docker-compose.yml next.config.ts README.md
git commit -m "chore: SQLite 部署配置、Docker 原生编译、文档与冒烟验证"
```

---

## Self-Review

**Spec coverage（spec 各节 → 任务）：**
- §3 目录结构 → Task 9/11（admin 迁入、public group）✅
- §4.1 schema 映射 → Task 2（schema.sql）✅
- §4.1 RPC/视图改写 → Task 4（history 采样/清理）、Task 5（availability）✅
- §4.2 连接 PRAGMA → Task 2（client.ts）✅
- §4.3 封装 + 返回值契约 → Task 3–6 + Task 7/10（调用点 try/catch）✅
- §4.4 async 保留 → 全数据层函数 async 签名 ✅
- §5 认证中间件 → Task 11（middleware 保护 /admin）✅
- §6 轮询去租约 → Task 8 ✅
- §7 依赖/.env/Dockerfile → Task 1/12 ✅
- §8 启动建表 → Task 11（instrumentation runMigrations）✅
- §9 测试策略（数据层/采样/type 校验/冒烟）→ Task 2–6 单测 + Task 12 冒烟 ✅
- §10 阶段拆分 → Task 1–12 对应 ✅
- §11 风险（不可水平扩展等）→ Task 12 README 记录 ✅

**Placeholder scan：** 无 TBD/TODO；每个改代码步骤含具体代码或精确替换指令。Task 6/7/9/10 部分为"按签名平铺实现"的机械替换，已给出关键模块完整代码 + 明确替换规则与 Interfaces 签名表，符合"重复代码已在 Interfaces 列明"。

**Type consistency：** `getRecentCheckHistory(limitPerConfig, targetConfigIds)`、`insertHistory(records)`、`pruneCheckHistory(retentionDays)`、`getAvailabilityStats(configIds)`、`loadEnabledConfigsWithModelTemplate()`、`__setDbForTest` 在定义（Task 2/4/5/6）与消费（Task 7/10 集成测试）处签名一致。✅

