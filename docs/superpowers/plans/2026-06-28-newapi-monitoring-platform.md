# newapi 监控平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Check CX 项目上扩展出一个监控多个 newapi 实例的平台：拉取聚合指标 + 主动实测 TTFT/连通性，按阈值规则评估并经飞书机器人分级路由告警。

**Architecture:** 复用 Check CX 的进程内单例轮询器，新增「采集器注册表」。一张 `monitor_tasks` 表用 `next_run_at` 驱动按任务独立调度；采集结果统一写入宽表 `metric_samples`；告警引擎每轮评估 `alert_rules` 并通过状态机去重/恢复，经飞书路由器推送交互卡片。

**Tech Stack:** Next.js 15 (App Router) · TypeScript · better-sqlite3 (SQLite, WAL) · vitest · node:crypto (AES-256-GCM)。前端复用现有 Base UI + Tailwind。

## Global Constraints

- **设计文档来源**：`docs/superpowers/specs/2026-06-28-newapi-monitoring-design.md`。
- **数据库风格**（沿用 `lib/db/schema.sql`）：TEXT 主键 = `crypto.randomUUID()`（用 `newId()`）；时间为 ISO8601 文本（用 `nowIso()`）；布尔用 `0/1`（用 `fromBool`/`toBool`）；id 与时间戳由应用层生成。
- **JSON 序列化**：用 `lib/db/json.ts` 的 `toJson`/`fromJson`，不直接 `JSON.parse` 业务数据。
- **DB 访问层风格**：每个表一个 `lib/db/*.ts` 模块，导出 `Row` 类型 + `Raw` 类型 + `mapRow` + CRUD 函数，全部 `import "server-only"`，通过 `getDb()` 取连接。
- **测试风格**（沿用 `tests/db/*.test.ts`）：用 `new Database(":memory:")` + 执行 `schema.sql` + `__setDbForTest(db)`；测试文件放 `tests/`，命名 `*.test.ts`；运行 `pnpm test`（vitest）。
- **保护信息**（newapi CLAUDE.md Rule 5）：禁止修改/删除任何 `new-api` / `QuantumNous` 标识。本计划只**读取** new-api 源码，不修改其任何文件。
- **PR 规范**（newapi CLAUDE.md Rule 8）：当前 git user `0xheliuni` 非 newapi 历史核心作者；如提 PR 需注明 AI 生成并使用 `.github/PULL_REQUEST_TEMPLATE.md`。
- **提交信息**：遵循 Conventional Commits（`feat:`/`fix:`/`test:`/`docs:`/`refactor:`）。
- **newapi 已核实事实**：
  - admin 拉取头：`Authorization: <admin_token>` + `New-Api-User: <admin_user_id>`。
  - `GET /api/data?start_timestamp=&end_timestamp=&username=` → `{success,data:QuotaData[]}`，`QuotaData = {model_name,username,created_at(秒),token_used,count,quota}`。
  - `GET /api/log?type=5&start_timestamp=&end_timestamp=&p=&page_size=` → `{success,data:{items:Log[],total,page,page_size}}`，`Log` 含 `model_name,quota,channel,channel_name,created_at(秒),content`。
  - `GET /api/channel/?p=&page_size=` → `{success,data:{items:Channel[],total,...}}`，`Channel` 含 `id,name,balance(float USD),balance_updated_time,status,type`（响应 `Omit("key")`）。
  - `GET /api/option/channel_affinity_cache`（需 root）→ `{success,data:{Enabled:bool,Total:int,Unknown:int,ByRuleName:{[name]:int}}}`。**注意：是缓存占用条目数，不是命中率**；故指标名用 `cache_entries`（非 `cache_hit_rate`）。
  - 时间戳：newapi 用 Unix 秒；本平台用 ISO8601 文本，采集器需在边界转换。

---

## File Structure

新增文件（全部在 Check CX 根 `E:\Prod_Project\other\Monitor_Platform` 下，不在 `new-api/` 内）：

```
lib/
├── types/monitor.ts              # 所有监控相关类型
├── db/
│   ├── schema.sql                # [修改] 追加 6 张表 + 索引
│   ├── monitor-crypto.ts         # AES-256-GCM 敏感字段加解密 + 脱敏
│   ├── targets.ts                # monitor_targets CRUD（读写时加解密 token/key）
│   ├── monitor-tasks.ts          # monitor_tasks CRUD + 到期任务查询 + 调度回写
│   ├── samples.ts                # metric_samples 写入 + 窗口聚合查询 + 清理
│   ├── alert-rules.ts            # alert_rules CRUD
│   ├── alert-events.ts           # alert_events 状态机读写
│   └── feishu.ts                 # feishu_webhooks CRUD + 路由选择
├── collectors/
│   ├── newapi-client.ts          # newapi admin HTTP 客户端（注入鉴权头 + 错误归一）
│   ├── index.ts                  # Collector 接口 + 分派器 runCollector()
│   ├── newapi-usage.ts           # /api/data → usage_quota/usage_tokens/request_count
│   ├── newapi-errors.ts          # /api/log?type=5 → error_count
│   ├── newapi-balance.ts         # /api/channel → channel_balance
│   ├── newapi-cache.ts           # /api/option/channel_affinity_cache → cache_entries
│   └── active-probe.ts           # 复用 lib/providers → ttft_ms/ping_ms/reachable
├── alerting/
│   ├── engine.ts                 # 规则评估 + 状态机 evaluateAlertRules()
│   └── feishu-card.ts            # 飞书交互卡片构造 + 签名 + 发送
└── core/
    └── monitor-runner.ts         # 一轮监控：调度采集 + 触发告警评估（被 poller 调用）

app/
├── admin/
│   ├── targets/{page.tsx,actions.ts}
│   ├── monitor-tasks/{page.tsx,actions.ts}
│   ├── alerts/{page.tsx,actions.ts}
│   ├── webhooks/{page.tsx,actions.ts}
│   └── alert-events/page.tsx
└── api/monitor/
    ├── targets/route.ts
    ├── targets/[id]/route.ts
    └── metrics/route.ts

tests/
├── db/{monitor-crypto,targets,monitor-tasks,samples,alert-rules,alert-events,feishu}.test.ts
├── collectors/{newapi-usage,newapi-errors,newapi-balance,newapi-cache,active-probe}.test.ts
└── alerting/{engine,feishu-card}.test.ts
```

修改文件：
- `lib/db/schema.sql`（追加表）
- `lib/core/poller.ts:90-122`（`tick()` 末尾调用 `runMonitorOnce()`）

---

## Task 1: 类型定义 + 数据库 Schema

**Files:**
- Create: `lib/types/monitor.ts`
- Modify: `lib/db/schema.sql`（在文件末尾、第 68 行之后追加）
- Test: `tests/db/monitor-schema.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces: 类型 `MonitorTargetRow`、`MonitorTaskRow`、`MetricSampleRow`、`AlertRuleRow`、`AlertEventRow`、`FeishuWebhookRow`、联合类型 `CollectorType`、`MetricName`、`TargetKind`；schema 中的 6 张表。

- [ ] **Step 1: 写类型文件**

Create `lib/types/monitor.ts`:

```typescript
/** 监控目标类型：自有实例（可拉聚合）/ 供应商实例（仅实测） */
export type TargetKind = "self" | "supplier";

/** 采集器类型 */
export type CollectorType =
  | "newapi_usage"
  | "newapi_errors"
  | "newapi_balance"
  | "newapi_cache"
  | "active_probe";

/** 时序指标名 */
export type MetricName =
  | "ttft_ms"
  | "ping_ms"
  | "reachable"
  | "usage_quota"
  | "usage_tokens"
  | "request_count"
  | "error_count"
  | "channel_balance"
  | "cache_entries";

export type AlertSeverity = "info" | "warning" | "critical";
export type Comparator = ">" | "<" | ">=" | "<=" | "==";
export type Aggregation = "sum" | "avg" | "max" | "min" | "count" | "last";
export type TaskStatus = "ok" | "failed" | "skipped";
export type AlertState = "firing" | "resolved";

export interface MonitorTargetRow {
  id: string;
  name: string;
  base_url: string;
  kind: TargetKind;
  admin_token: string | null;   // 解密后的明文（仅服务端内存）
  admin_user_id: string | null;
  probe_api_key: string | null; // 解密后的明文
  group_name: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MonitorTaskRow {
  id: string;
  target_id: string;
  name: string;
  collector_type: CollectorType;
  config: Record<string, unknown> | null;
  interval_seconds: number;
  enabled: boolean;
  is_maintenance: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: TaskStatus | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricSampleRow {
  id: number;
  task_id: string | null;
  target_id: string;
  metric: MetricName;
  dim_model: string | null;
  dim_user: string | null;
  dim_channel: string | null;
  value: number;
  checked_at: string;
  meta: Record<string, unknown> | null;
}

export interface AlertRuleRow {
  id: string;
  name: string;
  target_id: string | null;
  task_id: string | null;
  metric: MetricName;
  comparator: Comparator;
  threshold: number;
  window_seconds: number;
  aggregation: Aggregation;
  consecutive_breaches: number;
  severity: AlertSeverity;
  feishu_webhook_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeishuWebhookRow {
  id: string;
  name: string;
  webhook_url: string;
  secret: string | null;
  group_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEventRow {
  id: string;
  rule_id: string;
  state: AlertState;
  breach_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  resolved_at: string | null;
  last_notified_at: string | null;
  message: string | null;
}
```

- [ ] **Step 2: 追加 schema（在 `lib/db/schema.sql` 第 68 行后追加）**

```sql

-- ===== newapi 监控平台 =====

CREATE TABLE IF NOT EXISTS monitor_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('self','supplier')),
  admin_token TEXT,
  admin_user_id TEXT,
  probe_api_key TEXT,
  group_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_tasks (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  collector_type TEXT NOT NULL CHECK (collector_type IN
    ('newapi_usage','newapi_errors','newapi_balance','newapi_cache','active_probe')),
  config TEXT,
  interval_seconds INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES monitor_tasks(id) ON DELETE SET NULL,
  target_id TEXT NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  dim_model TEXT,
  dim_user TEXT,
  dim_channel TEXT,
  value REAL NOT NULL,
  checked_at TEXT NOT NULL,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS feishu_webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  secret TEXT,
  group_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_id TEXT REFERENCES monitor_targets(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL CHECK (comparator IN ('>','<','>=','<=','==')),
  threshold REAL NOT NULL,
  window_seconds INTEGER NOT NULL,
  aggregation TEXT NOT NULL CHECK (aggregation IN ('sum','avg','max','min','count','last')),
  consecutive_breaches INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  feishu_webhook_id TEXT REFERENCES feishu_webhooks(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('firing','resolved')),
  breach_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT,
  last_seen_at TEXT,
  resolved_at TEXT,
  last_notified_at TEXT,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_metric_samples_target_metric ON metric_samples (target_id, metric, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_metric_samples_task ON metric_samples (task_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_tasks_next_run ON monitor_tasks (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events (rule_id);
```

- [ ] **Step 3: 写测试**

Create `tests/db/monitor-schema.test.ts`:

```typescript
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

describe("monitor schema", () => {
  it("创建全部 6 张监控表", () => {
    const db = freshDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    for (const t of ["monitor_targets","monitor_tasks","metric_samples","feishu_webhooks","alert_rules","alert_events"]) {
      expect(names).toContain(t);
    }
  });

  it("外键级联：删除 target 连带删除其 task", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("t1","T","http://x","self",now,now);
    db.prepare("INSERT INTO monitor_tasks (id,target_id,name,collector_type,interval_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("k1","t1","K","active_probe",60,now,now);
    db.prepare("DELETE FROM monitor_targets WHERE id=?").run("t1");
    const count = db.prepare("SELECT COUNT(*) c FROM monitor_tasks").get() as any;
    expect(count.c).toBe(0);
  });

  it("collector_type CHECK 约束拒绝非法值", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("t1","T","http://x","self",now,now);
    expect(() =>
      db.prepare("INSERT INTO monitor_tasks (id,target_id,name,collector_type,interval_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("k1","t1","K","bogus",60,now,now)
    ).toThrow();
  });
});
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/db/monitor-schema.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/types/monitor.ts lib/db/schema.sql tests/db/monitor-schema.test.ts
git commit -m "feat(monitor): 监控平台类型定义与数据库 schema"
```

---

## Task 2: 敏感字段加解密模块

**Files:**
- Create: `lib/db/monitor-crypto.ts`
- Test: `tests/db/monitor-crypto.test.ts`

**Interfaces:**
- Consumes: 环境变量 `ADMIN_SESSION_SECRET`（现有，HMAC session 已用）。
- Produces:
  - `encryptSecret(plain: string): string`（返回 `base64(iv).base64(tag).base64(ciphertext)` 三段点分）
  - `decryptSecret(stored: string): string`
  - `maskSecret(plain: string | null): string`（如 `sk-****1234`，明文 ≤8 位全部打码）

- [ ] **Step 1: 写测试**

Create `tests/db/monitor-crypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/db/monitor-crypto";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret-please-change";
});

describe("monitor-crypto", () => {
  it("加密后能解密回原文", () => {
    const plain = "sk-abc123def456";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("两次加密同一明文得到不同密文（随机 IV）", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("脱敏只保留尾 4 位", () => {
    expect(maskSecret("sk-abcdef1234")).toBe("sk-****1234");
    expect(maskSecret("short")).toBe("****");
    expect(maskSecret(null)).toBe("");
  });

  it("密文被篡改时解密抛错", () => {
    const enc = encryptSecret("data");
    const tampered = enc.slice(0, -2) + (enc.endsWith("a") ? "bb" : "aa");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/db/monitor-crypto.test.ts`
Expected: FAIL（`Cannot find module '@/lib/db/monitor-crypto'`）。

- [ ] **Step 3: 写实现**

Create `lib/db/monitor-crypto.ts`:

```typescript
import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function deriveKey(): Buffer {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET 未配置，无法加密敏感字段");
  // HKDF-SHA256 派生 32 字节密钥，info 固定区分用途
  const derived = hkdfSync("sha256", secret, "monitor-salt", "monitor-secret-aes", 32);
  return Buffer.from(derived);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("密文格式非法");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

export function maskSecret(plain: string | null): string {
  if (!plain) return "";
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 3)}****${plain.slice(-4)}`;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/db/monitor-crypto.test.ts`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/db/monitor-crypto.ts tests/db/monitor-crypto.test.ts
git commit -m "feat(monitor): 敏感字段 AES-256-GCM 加解密与脱敏"
```

---

## Task 3: monitor_targets DB 层

**Files:**
- Create: `lib/db/targets.ts`
- Test: `tests/db/targets.test.ts`

**Interfaces:**
- Consumes: `getDb` (`lib/db/client`)；`newId,nowIso,toBool,fromBool` (`lib/db/json`)；`encryptSecret,decryptSecret` (`lib/db/monitor-crypto`)；类型 `MonitorTargetRow,TargetKind` (`lib/types/monitor`)。
- Produces:
  - `listTargets(): Promise<MonitorTargetRow[]>`（token/key 已解密为明文）
  - `getTarget(id: string): Promise<MonitorTargetRow | null>`
  - `createTarget(input: TargetInput): Promise<MonitorTargetRow>`
  - `updateTarget(id: string, input: Partial<TargetInput>): Promise<MonitorTargetRow | null>`
  - `deleteTarget(id: string): Promise<void>`
  - 类型 `TargetInput = { name; base_url; kind: TargetKind; admin_token: string|null; admin_user_id: string|null; probe_api_key: string|null; group_name: string|null; enabled: boolean }`

- [ ] **Step 1: 写测试**

Create `tests/db/targets.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest, getDb } from "@/lib/db/client";
import { createTarget, getTarget, listTargets, updateTarget, deleteTarget } from "@/lib/db/targets";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

const base = {
  name: "Prod A", base_url: "https://a.example.com", kind: "self" as const,
  admin_token: "acc-token-xyz", admin_user_id: "1", probe_api_key: "sk-probe-123",
  group_name: "生产", enabled: true,
};

describe("targets", () => {
  it("创建后读取返回解密明文", async () => {
    const t = await createTarget(base);
    const got = await getTarget(t.id);
    expect(got?.admin_token).toBe("acc-token-xyz");
    expect(got?.probe_api_key).toBe("sk-probe-123");
  });

  it("数据库中存储的是密文而非明文", async () => {
    const t = await createTarget(base);
    const raw = getDb().prepare("SELECT admin_token, probe_api_key FROM monitor_targets WHERE id=?").get(t.id) as any;
    expect(raw.admin_token).not.toBe("acc-token-xyz");
    expect(raw.admin_token).toContain(".");
  });

  it("供应商目标 token 为 null 不报错", async () => {
    const t = await createTarget({ ...base, kind: "supplier", admin_token: null, admin_user_id: null });
    const got = await getTarget(t.id);
    expect(got?.admin_token).toBeNull();
    expect(got?.probe_api_key).toBe("sk-probe-123");
  });

  it("更新 base_url 不影响未变更的密文字段", async () => {
    const t = await createTarget(base);
    await updateTarget(t.id, { base_url: "https://b.example.com" });
    const got = await getTarget(t.id);
    expect(got?.base_url).toBe("https://b.example.com");
    expect(got?.admin_token).toBe("acc-token-xyz");
  });

  it("删除后查不到", async () => {
    const t = await createTarget(base);
    await deleteTarget(t.id);
    expect(await getTarget(t.id)).toBeNull();
    expect(await listTargets()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/db/targets.test.ts`
Expected: FAIL（找不到模块 `@/lib/db/targets`）。

- [ ] **Step 3: 写实现**

Create `lib/db/targets.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool } from "./json";
import { encryptSecret, decryptSecret } from "./monitor-crypto";
import type { MonitorTargetRow, TargetKind } from "../types/monitor";

export type TargetInput = {
  name: string;
  base_url: string;
  kind: TargetKind;
  admin_token: string | null;
  admin_user_id: string | null;
  probe_api_key: string | null;
  group_name: string | null;
  enabled: boolean;
};

type TargetRaw = {
  id: string; name: string; base_url: string; kind: TargetKind;
  admin_token: string | null; admin_user_id: string | null; probe_api_key: string | null;
  group_name: string | null; enabled: 0 | 1; created_at: string; updated_at: string;
};

function dec(stored: string | null): string | null {
  return stored ? decryptSecret(stored) : null;
}

function mapRow(r: TargetRaw): MonitorTargetRow {
  return {
    id: r.id, name: r.name, base_url: r.base_url, kind: r.kind,
    admin_token: dec(r.admin_token), admin_user_id: r.admin_user_id,
    probe_api_key: dec(r.probe_api_key), group_name: r.group_name,
    enabled: toBool(r.enabled), created_at: r.created_at, updated_at: r.updated_at,
  };
}

const COLS = "id,name,base_url,kind,admin_token,admin_user_id,probe_api_key,group_name,enabled,created_at,updated_at";

export async function listTargets(): Promise<MonitorTargetRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM monitor_targets ORDER BY name ASC`).all() as TargetRaw[];
  return rows.map(mapRow);
}

export async function getTarget(id: string): Promise<MonitorTargetRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM monitor_targets WHERE id = ?`).get(id) as TargetRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createTarget(input: TargetInput): Promise<MonitorTargetRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO monitor_targets (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.base_url, input.kind,
    input.admin_token ? encryptSecret(input.admin_token) : null,
    input.admin_user_id,
    input.probe_api_key ? encryptSecret(input.probe_api_key) : null,
    input.group_name, fromBool(input.enabled), now, now
  );
  return (await getTarget(id))!;
}

export async function updateTarget(id: string, input: Partial<TargetInput>): Promise<MonitorTargetRow | null> {
  const db = getDb();
  const exists = db.prepare("SELECT id FROM monitor_targets WHERE id = ?").get(id);
  if (!exists) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.base_url !== undefined) { sets.push("base_url = ?"); params.push(input.base_url); }
  if (input.kind !== undefined) { sets.push("kind = ?"); params.push(input.kind); }
  if ("admin_token" in input) { sets.push("admin_token = ?"); params.push(input.admin_token ? encryptSecret(input.admin_token) : null); }
  if ("admin_user_id" in input) { sets.push("admin_user_id = ?"); params.push(input.admin_user_id ?? null); }
  if ("probe_api_key" in input) { sets.push("probe_api_key = ?"); params.push(input.probe_api_key ? encryptSecret(input.probe_api_key) : null); }
  if ("group_name" in input) { sets.push("group_name = ?"); params.push(input.group_name ?? null); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  params.push(id);
  db.prepare(`UPDATE monitor_targets SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getTarget(id);
}

export async function deleteTarget(id: string): Promise<void> {
  getDb().prepare("DELETE FROM monitor_targets WHERE id = ?").run(id);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/db/targets.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/db/targets.ts tests/db/targets.test.ts
git commit -m "feat(monitor): monitor_targets DB 层（含敏感字段加解密）"
```

---

## Task 4: monitor_tasks DB 层（含调度）

**Files:**
- Create: `lib/db/monitor-tasks.ts`
- Test: `tests/db/monitor-tasks.test.ts`

**Interfaces:**
- Consumes: `getDb`；`newId,nowIso,toBool,fromBool,toJson,fromJson`；类型 `MonitorTaskRow,CollectorType,TaskStatus`。
- Produces:
  - `listTasks(targetId?: string): Promise<MonitorTaskRow[]>`
  - `getTask(id: string): Promise<MonitorTaskRow | null>`
  - `createTask(input: TaskInput): Promise<MonitorTaskRow>`（创建时 `next_run_at = now`，即立即到期）
  - `updateTask(id: string, input: Partial<TaskInput>): Promise<MonitorTaskRow | null>`
  - `deleteTask(id: string): Promise<void>`
  - `getDueTasks(nowIso: string): Promise<MonitorTaskRow[]>`（`enabled=1 AND is_maintenance=0 AND (next_run_at IS NULL OR next_run_at <= nowIso)`）
  - `recordTaskRun(id: string, status: TaskStatus, error: string | null, nextRunAt: string): Promise<void>`
  - 类型 `TaskInput = { target_id; name; collector_type: CollectorType; config: Record<string,unknown>|null; interval_seconds: number; enabled: boolean; is_maintenance: boolean }`

- [ ] **Step 1: 写测试**

Create `tests/db/monitor-tasks.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTask, getTask, getDueTasks, recordTaskRun, updateTask } from "@/lib/db/monitor-tasks";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("t1","T","http://x","self",now,now);
  __setDbForTest(db);
});

const base = {
  target_id: "t1", name: "用量采集", collector_type: "newapi_usage" as const,
  config: { window: 300 }, interval_seconds: 300, enabled: true, is_maintenance: false,
};

describe("monitor-tasks", () => {
  it("创建时 next_run_at 立即到期，config 往返为对象", async () => {
    const k = await createTask(base);
    expect(k.config).toEqual({ window: 300 });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).toContain(k.id);
  });

  it("recordTaskRun 顺延 next_run_at 后不再到期", async () => {
    const k = await createTask(base);
    const future = new Date(Date.now() + 300_000).toISOString();
    await recordTaskRun(k.id, "ok", null, future);
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
    const got = await getTask(k.id);
    expect(got?.last_status).toBe("ok");
    expect(got?.next_run_at).toBe(future);
  });

  it("维护中的任务不到期", async () => {
    const k = await createTask({ ...base, is_maintenance: true });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
  });

  it("禁用的任务不到期", async () => {
    const k = await createTask({ ...base, enabled: false });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
  });

  it("recordTaskRun 记录失败原因", async () => {
    const k = await createTask(base);
    await recordTaskRun(k.id, "failed", "连接超时", new Date().toISOString());
    const got = await getTask(k.id);
    expect(got?.last_status).toBe("failed");
    expect(got?.last_error).toBe("连接超时");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/db/monitor-tasks.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

Create `lib/db/monitor-tasks.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool, toJson, fromJson } from "./json";
import type { MonitorTaskRow, CollectorType, TaskStatus } from "../types/monitor";

export type TaskInput = {
  target_id: string;
  name: string;
  collector_type: CollectorType;
  config: Record<string, unknown> | null;
  interval_seconds: number;
  enabled: boolean;
  is_maintenance: boolean;
};

type TaskRaw = {
  id: string; target_id: string; name: string; collector_type: CollectorType;
  config: string | null; interval_seconds: number; enabled: 0 | 1; is_maintenance: 0 | 1;
  next_run_at: string | null; last_run_at: string | null; last_status: TaskStatus | null;
  last_error: string | null; created_at: string; updated_at: string;
};

function mapRow(r: TaskRaw): MonitorTaskRow {
  return {
    id: r.id, target_id: r.target_id, name: r.name, collector_type: r.collector_type,
    config: fromJson<Record<string, unknown>>(r.config),
    interval_seconds: r.interval_seconds, enabled: toBool(r.enabled),
    is_maintenance: toBool(r.is_maintenance), next_run_at: r.next_run_at,
    last_run_at: r.last_run_at, last_status: r.last_status, last_error: r.last_error,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

const COLS = "id,target_id,name,collector_type,config,interval_seconds,enabled,is_maintenance,next_run_at,last_run_at,last_status,last_error,created_at,updated_at";

export async function listTasks(targetId?: string): Promise<MonitorTaskRow[]> {
  const db = getDb();
  const rows = (targetId
    ? db.prepare(`SELECT ${COLS} FROM monitor_tasks WHERE target_id = ? ORDER BY name ASC`).all(targetId)
    : db.prepare(`SELECT ${COLS} FROM monitor_tasks ORDER BY name ASC`).all()) as TaskRaw[];
  return rows.map(mapRow);
}

export async function getTask(id: string): Promise<MonitorTaskRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM monitor_tasks WHERE id = ?`).get(id) as TaskRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createTask(input: TaskInput): Promise<MonitorTaskRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO monitor_tasks (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.target_id, input.name, input.collector_type, toJson(input.config),
    input.interval_seconds, fromBool(input.enabled), fromBool(input.is_maintenance),
    now, null, null, null, now, now
  );
  return (await getTask(id))!;
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<MonitorTaskRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM monitor_tasks WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.collector_type !== undefined) { sets.push("collector_type = ?"); params.push(input.collector_type); }
  if ("config" in input) { sets.push("config = ?"); params.push(toJson(input.config ?? null)); }
  if (input.interval_seconds !== undefined) { sets.push("interval_seconds = ?"); params.push(input.interval_seconds); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  if (input.is_maintenance !== undefined) { sets.push("is_maintenance = ?"); params.push(fromBool(input.is_maintenance)); }
  params.push(id);
  db.prepare(`UPDATE monitor_tasks SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  getDb().prepare("DELETE FROM monitor_tasks WHERE id = ?").run(id);
}

export async function getDueTasks(now: string): Promise<MonitorTaskRow[]> {
  const rows = getDb().prepare(
    `SELECT ${COLS} FROM monitor_tasks
     WHERE enabled = 1 AND is_maintenance = 0
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY next_run_at ASC`
  ).all(now) as TaskRaw[];
  return rows.map(mapRow);
}

export async function recordTaskRun(
  id: string, status: TaskStatus, error: string | null, nextRunAt: string
): Promise<void> {
  getDb().prepare(
    `UPDATE monitor_tasks SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
  ).run(nowIso(), status, error, nextRunAt, nowIso(), id);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/db/monitor-tasks.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/db/monitor-tasks.ts tests/db/monitor-tasks.test.ts
git commit -m "feat(monitor): monitor_tasks DB 层与按 next_run_at 调度"
```

---

## Task 5: metric_samples DB 层（写入 + 窗口聚合 + 清理）

**Files:**
- Create: `lib/db/samples.ts`
- Test: `tests/db/samples.test.ts`

**Interfaces:**
- Consumes: `getDb`；`nowIso,toJson,fromJson`；类型 `MetricSampleRow,MetricName,Aggregation`。
- Produces:
  - `insertSamples(samples: SampleInput[]): Promise<void>`（批量，单事务）
  - `aggregateWindow(opts: { targetId?: string|null; taskId?: string|null; metric: MetricName; sinceIso: string; aggregation: Aggregation }): Promise<number | null>`（窗口内按聚合算子求单值；无样本返回 null）
  - `latestSamples(targetId: string, metric: MetricName, limit: number): Promise<MetricSampleRow[]>`
  - `querySeries(targetId: string, metric: MetricName, fromIso: string, toIso: string): Promise<MetricSampleRow[]>`
  - `cleanupSamples(retentionDays: number): Promise<number>`（删除早于 now-retentionDays 的样本，返回删除行数）
  - 类型 `SampleInput = { task_id: string|null; target_id: string; metric: MetricName; dim_model?: string|null; dim_user?: string|null; dim_channel?: string|null; value: number; checked_at: string; meta?: Record<string,unknown>|null }`

- [ ] **Step 1: 写测试**

Create `tests/db/samples.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { insertSamples, aggregateWindow, latestSamples, cleanupSamples } from "@/lib/db/samples";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("t1","T","http://x","self",now,now);
  __setDbForTest(db);
});

describe("samples", () => {
  it("批量写入并按 sum 聚合窗口", async () => {
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 3, checked_at: now },
      { task_id: null, target_id: "t1", metric: "error_count", value: 5, checked_at: now },
    ]);
    const sum = await aggregateWindow({
      targetId: "t1", metric: "error_count",
      sinceIso: new Date(Date.now() - 60_000).toISOString(), aggregation: "sum",
    });
    expect(sum).toBe(8);
  });

  it("avg/max/min/last 聚合", async () => {
    const t0 = new Date(Date.now() - 3000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 100, checked_at: t0 },
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 300, checked_at: t1 },
    ]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "avg" })).toBe(200);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "max" })).toBe(300);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "min" })).toBe(100);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "last" })).toBe(300);
  });

  it("窗口外样本不计入；窗口内无样本返回 null", async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "ttft_ms", value: 999, checked_at: old }]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "avg" })).toBeNull();
  });

  it("meta 往返为对象，latestSamples 倒序", async () => {
    const t0 = new Date(Date.now() - 2000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 1, checked_at: t0, meta: { sample: "a" } },
      { task_id: null, target_id: "t1", metric: "error_count", value: 2, checked_at: t1, meta: { sample: "b" } },
    ]);
    const latest = await latestSamples("t1", "error_count", 1);
    expect(latest[0].value).toBe(2);
    expect(latest[0].meta).toEqual({ sample: "b" });
  });

  it("cleanupSamples 删除过期样本", async () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    const fresh = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 1, checked_at: old },
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 2, checked_at: fresh },
    ]);
    const deleted = await cleanupSamples(30);
    expect(deleted).toBe(1);
    expect(await latestSamples("t1", "ttft_ms", 10)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/db/samples.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

Create `lib/db/samples.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { nowIso, toJson, fromJson } from "./json";
import type { MetricSampleRow, MetricName, Aggregation } from "../types/monitor";

export type SampleInput = {
  task_id: string | null;
  target_id: string;
  metric: MetricName;
  dim_model?: string | null;
  dim_user?: string | null;
  dim_channel?: string | null;
  value: number;
  checked_at: string;
  meta?: Record<string, unknown> | null;
};

type SampleRaw = {
  id: number; task_id: string | null; target_id: string; metric: MetricName;
  dim_model: string | null; dim_user: string | null; dim_channel: string | null;
  value: number; checked_at: string; meta: string | null;
};

function mapRow(r: SampleRaw): MetricSampleRow {
  return {
    id: r.id, task_id: r.task_id, target_id: r.target_id, metric: r.metric,
    dim_model: r.dim_model, dim_user: r.dim_user, dim_channel: r.dim_channel,
    value: r.value, checked_at: r.checked_at, meta: fromJson<Record<string, unknown>>(r.meta),
  };
}

export async function insertSamples(samples: SampleInput[]): Promise<void> {
  if (samples.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO metric_samples (task_id,target_id,metric,dim_model,dim_user,dim_channel,value,checked_at,meta)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const tx = db.transaction((rows: SampleInput[]) => {
    for (const s of rows) {
      stmt.run(
        s.task_id, s.target_id, s.metric, s.dim_model ?? null, s.dim_user ?? null,
        s.dim_channel ?? null, s.value, s.checked_at, toJson(s.meta ?? null)
      );
    }
  });
  tx(samples);
}

const AGG_FN: Record<Exclude<Aggregation, "last">, string> = {
  sum: "SUM(value)", avg: "AVG(value)", max: "MAX(value)", min: "MIN(value)", count: "COUNT(*)",
};

export async function aggregateWindow(opts: {
  targetId?: string | null;
  taskId?: string | null;
  metric: MetricName;
  sinceIso: string;
  aggregation: Aggregation;
}): Promise<number | null> {
  const db = getDb();
  const where: string[] = ["metric = ?", "checked_at >= ?"];
  const params: unknown[] = [opts.metric, opts.sinceIso];
  if (opts.targetId) { where.push("target_id = ?"); params.push(opts.targetId); }
  if (opts.taskId) { where.push("task_id = ?"); params.push(opts.taskId); }
  const whereSql = where.join(" AND ");

  if (opts.aggregation === "last") {
    const row = db.prepare(
      `SELECT value FROM metric_samples WHERE ${whereSql} ORDER BY checked_at DESC, id DESC LIMIT 1`
    ).get(...params) as { value: number } | undefined;
    return row ? row.value : null;
  }
  const row = db.prepare(
    `SELECT ${AGG_FN[opts.aggregation]} AS v FROM metric_samples WHERE ${whereSql}`
  ).get(...params) as { v: number | null };
  if (opts.aggregation === "count") return row.v ?? 0;
  return row.v ?? null;
}

export async function latestSamples(targetId: string, metric: MetricName, limit: number): Promise<MetricSampleRow[]> {
  const rows = getDb().prepare(
    `SELECT * FROM metric_samples WHERE target_id = ? AND metric = ? ORDER BY checked_at DESC, id DESC LIMIT ?`
  ).all(targetId, metric, limit) as SampleRaw[];
  return rows.map(mapRow);
}

export async function querySeries(targetId: string, metric: MetricName, fromIso: string, toIso: string): Promise<MetricSampleRow[]> {
  const rows = getDb().prepare(
    `SELECT * FROM metric_samples WHERE target_id = ? AND metric = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC`
  ).all(targetId, metric, fromIso, toIso) as SampleRaw[];
  return rows.map(mapRow);
}

export async function cleanupSamples(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
  const info = getDb().prepare("DELETE FROM metric_samples WHERE checked_at < ?").run(cutoff);
  return info.changes;
}
```

注：`nowIso` 在本模块未直接使用可不导入；若 lint 报未用，删去该 import。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/db/samples.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/db/samples.ts tests/db/samples.test.ts
git commit -m "feat(monitor): metric_samples 写入、窗口聚合与清理"
```

---

## Task 6: 告警规则 / 事件 / 飞书 webhook DB 层

**Files:**
- Create: `lib/db/alert-rules.ts`, `lib/db/alert-events.ts`, `lib/db/feishu.ts`
- Test: `tests/db/alert-rules.test.ts`, `tests/db/alert-events.test.ts`, `tests/db/feishu.test.ts`

**Interfaces:**
- Consumes: `getDb`；`newId,nowIso,toBool,fromBool`；类型 `AlertRuleRow,AlertEventRow,FeishuWebhookRow,AlertState` 等。
- Produces:
  - alert-rules：`listRules()`,`getRule(id)`,`createRule(input)`,`updateRule(id,input)`,`deleteRule(id)`,`listEnabledRules(): Promise<AlertRuleRow[]>`；类型 `RuleInput`。
  - alert-events：`getEventByRule(ruleId): Promise<AlertEventRow|null>`,`upsertEvent(ruleId, patch): Promise<AlertEventRow>`,`listRecentEvents(limit): Promise<AlertEventRow[]>`。
  - feishu：`listWebhooks()`,`getWebhook(id)`,`createWebhook(input)`,`updateWebhook(id,input)`,`deleteWebhook(id)`,`resolveWebhook(opts:{ webhookId?: string|null; groupName?: string|null }): Promise<FeishuWebhookRow|null>`（优先级：显式 id → 匹配 group_name → group_name 为 NULL 的默认）；类型 `WebhookInput`。

- [ ] **Step 1: 写 feishu 测试（含路由优先级）**

Create `tests/db/feishu.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createWebhook, resolveWebhook } from "@/lib/db/feishu";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

describe("feishu webhook 路由", () => {
  it("优先用显式 webhookId", async () => {
    const w = await createWebhook({ name: "A", webhook_url: "http://a", secret: null, group_name: "g1" });
    await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: w.id, groupName: "g1" });
    expect(r?.id).toBe(w.id);
  });

  it("无显式 id 时按 group_name 匹配", async () => {
    const g = await createWebhook({ name: "G", webhook_url: "http://g", secret: null, group_name: "生产" });
    await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: null, groupName: "生产" });
    expect(r?.id).toBe(g.id);
  });

  it("group 无匹配时回退到默认（group_name 为 NULL）", async () => {
    const d = await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: null, groupName: "未知" });
    expect(r?.id).toBe(d.id);
  });

  it("既无匹配也无默认时返回 null", async () => {
    await createWebhook({ name: "G", webhook_url: "http://g", secret: null, group_name: "生产" });
    const r = await resolveWebhook({ webhookId: null, groupName: "未知" });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: 写 alert-events 测试**

Create `tests/db/alert-events.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { getEventByRule, upsertEvent } from "@/lib/db/alert-events";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO feishu_webhooks (id,name,webhook_url,created_at,updated_at) VALUES (?,?,?,?,?)").run("w1","W","http://w",now,now);
  db.prepare(`INSERT INTO alert_rules (id,name,metric,comparator,threshold,window_seconds,aggregation,severity,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run("r1","R","error_count",">",10,300,"sum","warning",now,now);
  __setDbForTest(db);
});

describe("alert-events 状态机存储", () => {
  it("首次 upsert 创建事件，再次 upsert 更新同一行", async () => {
    expect(await getEventByRule("r1")).toBeNull();
    const now = new Date().toISOString();
    const e1 = await upsertEvent("r1", { state: "firing", breach_count: 1, first_seen_at: now, last_seen_at: now, message: "x" });
    expect(e1.state).toBe("firing");
    const e2 = await upsertEvent("r1", { state: "resolved", breach_count: 0, resolved_at: now });
    expect(e2.id).toBe(e1.id);
    expect(e2.state).toBe("resolved");
    const all = (await getEventByRule("r1"));
    expect(all?.state).toBe("resolved");
  });
});
```

- [ ] **Step 3: 写 alert-rules 测试**

Create `tests/db/alert-rules.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createRule, getRule, listEnabledRules, updateRule } from "@/lib/db/alert-rules";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

const base = {
  name: "错误激增", target_id: null, task_id: null, metric: "error_count" as const,
  comparator: ">" as const, threshold: 20, window_seconds: 300, aggregation: "sum" as const,
  consecutive_breaches: 2, severity: "critical" as const, feishu_webhook_id: null, enabled: true,
};

describe("alert-rules", () => {
  it("创建并读取", async () => {
    const r = await createRule(base);
    const got = await getRule(r.id);
    expect(got?.threshold).toBe(20);
    expect(got?.consecutive_breaches).toBe(2);
  });

  it("listEnabledRules 只返回启用的", async () => {
    await createRule(base);
    await createRule({ ...base, name: "禁用规则", enabled: false });
    const enabled = await listEnabledRules();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("错误激增");
  });

  it("更新阈值", async () => {
    const r = await createRule(base);
    await updateRule(r.id, { threshold: 50 });
    expect((await getRule(r.id))?.threshold).toBe(50);
  });
});
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `pnpm test tests/db/feishu.test.ts tests/db/alert-events.test.ts tests/db/alert-rules.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 5: 写 feishu 实现**

Create `lib/db/feishu.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { newId, nowIso } from "./json";
import type { FeishuWebhookRow } from "../types/monitor";

export type WebhookInput = {
  name: string; webhook_url: string; secret: string | null; group_name: string | null;
};

const COLS = "id,name,webhook_url,secret,group_name,created_at,updated_at";

export async function listWebhooks(): Promise<FeishuWebhookRow[]> {
  return getDb().prepare(`SELECT ${COLS} FROM feishu_webhooks ORDER BY name ASC`).all() as FeishuWebhookRow[];
}

export async function getWebhook(id: string): Promise<FeishuWebhookRow | null> {
  return (getDb().prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE id = ?`).get(id) as FeishuWebhookRow | undefined) ?? null;
}

export async function createWebhook(input: WebhookInput): Promise<FeishuWebhookRow> {
  const id = newId();
  const now = nowIso();
  getDb().prepare(`INSERT INTO feishu_webhooks (${COLS}) VALUES (?,?,?,?,?,?,?)`)
    .run(id, input.name, input.webhook_url, input.secret, input.group_name, now, now);
  return (await getWebhook(id))!;
}

export async function updateWebhook(id: string, input: Partial<WebhookInput>): Promise<FeishuWebhookRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM feishu_webhooks WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.webhook_url !== undefined) { sets.push("webhook_url = ?"); params.push(input.webhook_url); }
  if ("secret" in input) { sets.push("secret = ?"); params.push(input.secret ?? null); }
  if ("group_name" in input) { sets.push("group_name = ?"); params.push(input.group_name ?? null); }
  params.push(id);
  db.prepare(`UPDATE feishu_webhooks SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getWebhook(id);
}

export async function deleteWebhook(id: string): Promise<void> {
  getDb().prepare("DELETE FROM feishu_webhooks WHERE id = ?").run(id);
}

export async function resolveWebhook(opts: { webhookId?: string | null; groupName?: string | null }): Promise<FeishuWebhookRow | null> {
  if (opts.webhookId) {
    const explicit = await getWebhook(opts.webhookId);
    if (explicit) return explicit;
  }
  const db = getDb();
  if (opts.groupName) {
    const byGroup = db.prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE group_name = ? LIMIT 1`).get(opts.groupName) as FeishuWebhookRow | undefined;
    if (byGroup) return byGroup;
  }
  const dft = db.prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE group_name IS NULL LIMIT 1`).get() as FeishuWebhookRow | undefined;
  return dft ?? null;
}
```

- [ ] **Step 6: 写 alert-events 实现**

Create `lib/db/alert-events.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { newId } from "./json";
import type { AlertEventRow, AlertState } from "../types/monitor";

const COLS = "id,rule_id,state,breach_count,first_seen_at,last_seen_at,resolved_at,last_notified_at,message";

export async function getEventByRule(ruleId: string): Promise<AlertEventRow | null> {
  return (getDb().prepare(`SELECT ${COLS} FROM alert_events WHERE rule_id = ?`).get(ruleId) as AlertEventRow | undefined) ?? null;
}

export type EventPatch = {
  state?: AlertState;
  breach_count?: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  resolved_at?: string | null;
  last_notified_at?: string | null;
  message?: string | null;
};

export async function upsertEvent(ruleId: string, patch: EventPatch): Promise<AlertEventRow> {
  const db = getDb();
  const existing = await getEventByRule(ruleId);
  if (!existing) {
    const id = newId();
    db.prepare(
      `INSERT INTO alert_events (id,rule_id,state,breach_count,first_seen_at,last_seen_at,resolved_at,last_notified_at,message)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      id, ruleId, patch.state ?? "firing", patch.breach_count ?? 0,
      patch.first_seen_at ?? null, patch.last_seen_at ?? null, patch.resolved_at ?? null,
      patch.last_notified_at ?? null, patch.message ?? null
    );
    return (await getEventByRule(ruleId))!;
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  const fields: (keyof EventPatch)[] = ["state","breach_count","first_seen_at","last_seen_at","resolved_at","last_notified_at","message"];
  for (const f of fields) {
    if (f in patch) { sets.push(`${f} = ?`); params.push(patch[f] ?? null); }
  }
  if (sets.length > 0) {
    params.push(ruleId);
    db.prepare(`UPDATE alert_events SET ${sets.join(",")} WHERE rule_id = ?`).run(...params);
  }
  return (await getEventByRule(ruleId))!;
}

export async function listRecentEvents(limit: number): Promise<AlertEventRow[]> {
  return getDb().prepare(
    `SELECT ${COLS} FROM alert_events ORDER BY COALESCE(last_seen_at, first_seen_at) DESC LIMIT ?`
  ).all(limit) as AlertEventRow[];
}
```

- [ ] **Step 7: 写 alert-rules 实现**

Create `lib/db/alert-rules.ts`:

```typescript
import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool } from "./json";
import type { AlertRuleRow, MetricName, Comparator, Aggregation, AlertSeverity } from "../types/monitor";

export type RuleInput = {
  name: string;
  target_id: string | null;
  task_id: string | null;
  metric: MetricName;
  comparator: Comparator;
  threshold: number;
  window_seconds: number;
  aggregation: Aggregation;
  consecutive_breaches: number;
  severity: AlertSeverity;
  feishu_webhook_id: string | null;
  enabled: boolean;
};

type RuleRaw = Omit<AlertRuleRow, "enabled"> & { enabled: 0 | 1 };

const COLS = "id,name,target_id,task_id,metric,comparator,threshold,window_seconds,aggregation,consecutive_breaches,severity,feishu_webhook_id,enabled,created_at,updated_at";

function mapRow(r: RuleRaw): AlertRuleRow {
  return { ...r, enabled: toBool(r.enabled) };
}

export async function listRules(): Promise<AlertRuleRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM alert_rules ORDER BY name ASC`).all() as RuleRaw[];
  return rows.map(mapRow);
}

export async function listEnabledRules(): Promise<AlertRuleRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM alert_rules WHERE enabled = 1`).all() as RuleRaw[];
  return rows.map(mapRow);
}

export async function getRule(id: string): Promise<AlertRuleRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM alert_rules WHERE id = ?`).get(id) as RuleRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createRule(input: RuleInput): Promise<AlertRuleRow> {
  const id = newId();
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO alert_rules (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.target_id, input.task_id, input.metric, input.comparator,
    input.threshold, input.window_seconds, input.aggregation, input.consecutive_breaches,
    input.severity, input.feishu_webhook_id, fromBool(input.enabled), now, now
  );
  return (await getRule(id))!;
}

export async function updateRule(id: string, input: Partial<RuleInput>): Promise<AlertRuleRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM alert_rules WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  const scalar: (keyof RuleInput)[] = ["name","metric","comparator","threshold","window_seconds","aggregation","consecutive_breaches","severity"];
  for (const f of scalar) {
    if (input[f] !== undefined) { sets.push(`${f} = ?`); params.push(input[f]); }
  }
  if ("target_id" in input) { sets.push("target_id = ?"); params.push(input.target_id ?? null); }
  if ("task_id" in input) { sets.push("task_id = ?"); params.push(input.task_id ?? null); }
  if ("feishu_webhook_id" in input) { sets.push("feishu_webhook_id = ?"); params.push(input.feishu_webhook_id ?? null); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  params.push(id);
  db.prepare(`UPDATE alert_rules SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getRule(id);
}

export async function deleteRule(id: string): Promise<void> {
  getDb().prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `pnpm test tests/db/feishu.test.ts tests/db/alert-events.test.ts tests/db/alert-rules.test.ts`
Expected: 全部 passed（feishu 4 + events 1 + rules 3）。

- [ ] **Step 9: 提交**

```bash
git add lib/db/alert-rules.ts lib/db/alert-events.ts lib/db/feishu.ts tests/db/alert-rules.test.ts tests/db/alert-events.test.ts tests/db/feishu.test.ts
git commit -m "feat(monitor): 告警规则/事件/飞书 webhook DB 层"
```

---

## Task 7: newapi admin HTTP 客户端 + 采集器接口/分派器

**Files:**
- Create: `lib/collectors/newapi-client.ts`, `lib/collectors/index.ts`
- Test: `tests/collectors/newapi-client.test.ts`

**Interfaces:**
- Consumes: 类型 `MonitorTargetRow,MonitorTaskRow`；DB 写入 `insertSamples` (`lib/db/samples`)；具体采集器（Task 8/9，分派器 import 它们）。
- Produces:
  - `newapiGet(target: MonitorTargetRow, path: string, query?: Record<string,string|number>): Promise<unknown>`（注入 `Authorization` + `New-Api-User`，15s 超时，解析 `{success,data}` 信封，`success=false` 抛错）
  - `unixToIso(sec: number): string`、`isoToUnix(iso: string): number`
  - 接口 `Collector { run(target, task): Promise<SampleInput[]> }`
  - `runCollector(target: MonitorTargetRow, task: MonitorTaskRow): Promise<SampleInput[]>`（按 `task.collector_type` 分派；未知类型抛错；`active_probe` 外的采集器在 `target.kind==='supplier'` 时抛 `SkipCollector`）
  - `class SkipCollector extends Error`（分派/runner 用它区分「跳过」与「失败」）

- [ ] **Step 1: 写测试**

Create `tests/collectors/newapi-client.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { newapiGet, unixToIso, isoToUnix } from "@/lib/collectors/newapi-client";
import type { MonitorTargetRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("newapi-client", () => {
  it("注入鉴权头并解析 data 信封", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: 1 } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const data = await newapiGet(target, "/api/data", { start_timestamp: 100 });
    expect(data).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.example.com/api/data?start_timestamp=100");
    expect((init.headers as Record<string,string>)["Authorization"]).toBe("acc-1");
    expect((init.headers as Record<string,string>)["New-Api-User"]).toBe("1");
  });

  it("success=false 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: "无权限" }), { status: 200 })
    ));
    await expect(newapiGet(target, "/api/data")).rejects.toThrow("无权限");
  });

  it("HTTP 非 2xx 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(newapiGet(target, "/api/data")).rejects.toThrow(/500/);
  });

  it("时间戳转换", () => {
    expect(unixToIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoToUnix("1970-01-01T00:00:10.000Z")).toBe(10);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/collectors/newapi-client.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写 newapi-client 实现**

Create `lib/collectors/newapi-client.ts`:

```typescript
import "server-only";
import type { MonitorTargetRow } from "../types/monitor";

const REQUEST_TIMEOUT_MS = 15_000;

export function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

export function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function joinUrl(baseUrl: string, path: string, query?: Record<string, string | number>): string {
  const base = baseUrl.replace(/\/+$/, "");
  const qs = query
    ? "?" + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : "";
  return `${base}${path}${qs}`;
}

export async function newapiGet(
  target: MonitorTargetRow,
  path: string,
  query?: Record<string, string | number>
): Promise<unknown> {
  if (!target.admin_token || !target.admin_user_id) {
    throw new Error(`目标 ${target.name} 缺少 admin token / user id，无法拉取`);
  }
  const url = joinUrl(target.base_url, path, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": target.admin_token,
        "New-Api-User": target.admin_user_id,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`newapi ${path} HTTP ${res.status}`);
    const body = (await res.json()) as { success?: boolean; data?: unknown; message?: string };
    if (body.success === false) throw new Error(body.message || `newapi ${path} 返回 success=false`);
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/collectors/newapi-client.test.ts`
Expected: 4 passed。

- [ ] **Step 5: 写分派器（依赖 Task 8/9 的采集器，先写接口与 SkipCollector，采集器 import 在 Task 8/9 落地后补全）**

Create `lib/collectors/index.ts`:

```typescript
import "server-only";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";
import type { SampleInput } from "../db/samples";
import { collectUsage } from "./newapi-usage";
import { collectErrors } from "./newapi-errors";
import { collectBalance } from "./newapi-balance";
import { collectCache } from "./newapi-cache";
import { collectProbe } from "./active-probe";

export class SkipCollector extends Error {}

export type CollectorFn = (target: MonitorTargetRow, task: MonitorTaskRow) => Promise<SampleInput[]>;

const REGISTRY: Record<string, CollectorFn> = {
  newapi_usage: collectUsage,
  newapi_errors: collectErrors,
  newapi_balance: collectBalance,
  newapi_cache: collectCache,
  active_probe: collectProbe,
};

export async function runCollector(target: MonitorTargetRow, task: MonitorTaskRow): Promise<SampleInput[]> {
  const fn = REGISTRY[task.collector_type];
  if (!fn) throw new Error(`未知采集器类型：${task.collector_type}`);
  if (task.collector_type !== "active_probe" && target.kind === "supplier") {
    throw new SkipCollector(`供应商目标仅支持 active_probe，跳过 ${task.collector_type}`);
  }
  return fn(target, task);
}
```

注：本步骤的 `index.ts` 在 Task 8/9 完成前无法编译通过（import 尚不存在），这是有意的依赖顺序——**Task 7 的提交只包含 newapi-client.ts 及其测试**；`index.ts` 在 Task 9 末尾随采集器一起提交。

- [ ] **Step 6: 提交（仅 client）**

```bash
git add lib/collectors/newapi-client.ts tests/collectors/newapi-client.test.ts
git commit -m "feat(monitor): newapi admin HTTP 客户端与时间戳工具"
```

---

## Task 8: 拉取型采集器（usage / errors / balance / cache）

**Files:**
- Create: `lib/collectors/newapi-usage.ts`, `lib/collectors/newapi-errors.ts`, `lib/collectors/newapi-balance.ts`, `lib/collectors/newapi-cache.ts`
- Test: `tests/collectors/newapi-usage.test.ts`, `tests/collectors/newapi-errors.test.ts`, `tests/collectors/newapi-balance.test.ts`, `tests/collectors/newapi-cache.test.ts`

**Interfaces:**
- Consumes: `newapiGet,unixToIso,isoToUnix` (`lib/collectors/newapi-client`)；`SkipCollector` (`lib/collectors/index`，cache 用)；`SampleInput` (`lib/db/samples`)；类型 `MonitorTargetRow,MonitorTaskRow`。
- Produces:
  - `collectUsage(target, task): Promise<SampleInput[]>` — 拉 `/api/data`，每条 QuotaData 产出 3 个 sample（`usage_quota`/`usage_tokens`/`request_count`，dim_model+dim_user）。
  - `collectErrors(target, task): Promise<SampleInput[]>` — 拉 `/api/log?type=5`，按 channel 聚合产出 `error_count`（dim_channel），meta 含最近错误摘要。
  - `collectBalance(target, task): Promise<SampleInput[]>` — 拉 `/api/channel/`，每渠道产出 `channel_balance`（dim_channel）。
  - `collectCache(target, task): Promise<SampleInput[]>` — 拉 `/api/option/channel_affinity_cache`，产出 `cache_entries`（value=Total），meta 含 ByRuleName。若 newapi 返回 success=false（非 root），newapiGet 已抛错，由 runner 记为 failed。
- 窗口约定：`usage`/`errors` 用 `[isoToUnix(task.last_run_at ?? now-interval), isoToUnix(now)]` 作为 `start_timestamp`/`end_timestamp`；采集器内 `checked_at` 统一用传入的 `nowIso`。为可测，采集器接受第三参 `now: string = new Date().toISOString()`。

- [ ] **Step 1: 写 usage 测试**

Create `tests/collectors/newapi-usage.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectUsage } from "@/lib/collectors/newapi-usage";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "usage", collector_type: "newapi_usage",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null,
  created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectUsage", () => {
  it("每条 QuotaData 产出 quota/tokens/count 三个 sample", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [
        { model_name: "gpt-4o", username: "alice", created_at: 1700000000, token_used: 1200, count: 5, quota: 800 },
      ],
    }), { status: 200 })));
    const now = "2026-06-28T00:00:00.000Z";
    const samples = await collectUsage(target, task, now);
    expect(samples).toHaveLength(3);
    const byMetric = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(byMetric.usage_quota).toBe(800);
    expect(byMetric.usage_tokens).toBe(1200);
    expect(byMetric.request_count).toBe(5);
    expect(samples[0].dim_model).toBe("gpt-4o");
    expect(samples[0].dim_user).toBe("alice");
    expect(samples[0].checked_at).toBe(now);
  });

  it("空数据返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })));
    expect(await collectUsage(target, task, "2026-06-28T00:00:00.000Z")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 写 errors / balance / cache 测试**

Create `tests/collectors/newapi-errors.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectErrors } from "@/lib/collectors/newapi-errors";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "errors", collector_type: "newapi_errors",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectErrors", () => {
  it("按 channel 聚合 error_count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [
        { channel: 7, channel_name: "Azure", model_name: "gpt-4o", created_at: 1700000000, content: "500 err" },
        { channel: 7, channel_name: "Azure", model_name: "gpt-4o", created_at: 1700000001, content: "timeout" },
        { channel: 9, channel_name: "OpenAI", model_name: "gpt-4o", created_at: 1700000002, content: "401" },
      ], total: 3 },
    }), { status: 200 })));
    const samples = await collectErrors(target, task, "2026-06-28T00:00:00.000Z");
    const ch7 = samples.find((s) => s.dim_channel === "7");
    const ch9 = samples.find((s) => s.dim_channel === "9");
    expect(ch7?.metric).toBe("error_count");
    expect(ch7?.value).toBe(2);
    expect(ch9?.value).toBe(1);
  });

  it("无错误返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [], total: 0 } }), { status: 200 })));
    expect(await collectErrors(target, task, "2026-06-28T00:00:00.000Z")).toHaveLength(0);
  });
});
```

Create `tests/collectors/newapi-balance.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectBalance } from "@/lib/collectors/newapi-balance";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "balance", collector_type: "newapi_balance",
  config: null, interval_seconds: 600, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectBalance", () => {
  it("每渠道产出 channel_balance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [
        { id: 7, name: "Azure", balance: 12.5, type: 1, status: 1 },
        { id: 9, name: "OpenAI", balance: 0.3, type: 1, status: 1 },
      ], total: 2 },
    }), { status: 200 })));
    const samples = await collectBalance(target, task, "2026-06-28T00:00:00.000Z");
    expect(samples).toHaveLength(2);
    const ch9 = samples.find((s) => s.dim_channel === "9");
    expect(ch9?.metric).toBe("channel_balance");
    expect(ch9?.value).toBe(0.3);
    expect(ch9?.meta).toMatchObject({ name: "OpenAI" });
  });
});
```

Create `tests/collectors/newapi-cache.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { collectCache } from "@/lib/collectors/newapi-cache";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "cache", collector_type: "newapi_cache",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectCache", () => {
  it("产出 cache_entries（value=Total），meta 含 ByRuleName", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { Enabled: true, Total: 42, Unknown: 3, ByRuleName: { ruleA: 40, ruleB: 2 } },
    }), { status: 200 })));
    const samples = await collectCache(target, task, "2026-06-28T00:00:00.000Z");
    expect(samples).toHaveLength(1);
    expect(samples[0].metric).toBe("cache_entries");
    expect(samples[0].value).toBe(42);
    expect(samples[0].meta).toMatchObject({ ByRuleName: { ruleA: 40, ruleB: 2 }, Unknown: 3 });
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test tests/collectors/newapi-usage.test.ts tests/collectors/newapi-errors.test.ts tests/collectors/newapi-balance.test.ts tests/collectors/newapi-cache.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 4: 写 usage 实现**

Create `lib/collectors/newapi-usage.ts`:

```typescript
import "server-only";
import { newapiGet, isoToUnix } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type QuotaData = {
  model_name: string; username: string; created_at: number;
  token_used: number; count: number; quota: number;
};

export async function collectUsage(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const start = task.last_run_at ?? new Date(Date.parse(now) - task.interval_seconds * 1000).toISOString();
  const data = (await newapiGet(target, "/api/data", {
    start_timestamp: isoToUnix(start),
    end_timestamp: isoToUnix(now),
  })) as QuotaData[] | null;
  const rows = data ?? [];
  const samples: SampleInput[] = [];
  for (const r of rows) {
    const dims = { dim_model: r.model_name || null, dim_user: r.username || null };
    samples.push(
      { task_id: task.id, target_id: target.id, metric: "usage_quota", value: r.quota, checked_at: now, ...dims },
      { task_id: task.id, target_id: target.id, metric: "usage_tokens", value: r.token_used, checked_at: now, ...dims },
      { task_id: task.id, target_id: target.id, metric: "request_count", value: r.count, checked_at: now, ...dims },
    );
  }
  return samples;
}
```

- [ ] **Step 5: 写 errors 实现**

Create `lib/collectors/newapi-errors.ts`:

```typescript
import "server-only";
import { newapiGet, isoToUnix } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type LogItem = {
  channel: number; channel_name?: string; model_name?: string;
  created_at: number; content?: string;
};

export async function collectErrors(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const start = task.last_run_at ?? new Date(Date.parse(now) - task.interval_seconds * 1000).toISOString();
  const data = (await newapiGet(target, "/api/log", {
    type: 5,
    start_timestamp: isoToUnix(start),
    end_timestamp: isoToUnix(now),
    p: 1,
    page_size: 100,
  })) as { items?: LogItem[]; total?: number } | null;
  const items = data?.items ?? [];

  const byChannel = new Map<number, { count: number; name?: string; lastContent?: string }>();
  for (const it of items) {
    const cur = byChannel.get(it.channel) ?? { count: 0, name: it.channel_name };
    cur.count += 1;
    cur.lastContent = it.content;
    byChannel.set(it.channel, cur);
  }

  const samples: SampleInput[] = [];
  for (const [channel, agg] of byChannel) {
    samples.push({
      task_id: task.id, target_id: target.id, metric: "error_count",
      dim_channel: String(channel), value: agg.count, checked_at: now,
      meta: { channel_name: agg.name ?? null, last_content: agg.lastContent ?? null, total: data?.total ?? items.length },
    });
  }
  return samples;
}
```

- [ ] **Step 6: 写 balance 实现**

Create `lib/collectors/newapi-balance.ts`:

```typescript
import "server-only";
import { newapiGet } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type ChannelItem = { id: number; name?: string; balance?: number; type?: number; status?: number };

export async function collectBalance(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const data = (await newapiGet(target, "/api/channel/", { p: 1, page_size: 100 })) as
    { items?: ChannelItem[] } | null;
  const items = data?.items ?? [];
  return items.map((c) => ({
    task_id: task.id, target_id: target.id, metric: "channel_balance" as const,
    dim_channel: String(c.id), value: typeof c.balance === "number" ? c.balance : 0,
    checked_at: now, meta: { name: c.name ?? null, status: c.status ?? null, type: c.type ?? null },
  }));
}
```

- [ ] **Step 7: 写 cache 实现**

Create `lib/collectors/newapi-cache.ts`:

```typescript
import "server-only";
import { newapiGet } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type CacheStats = { Enabled: boolean; Total: number; Unknown: number; ByRuleName: Record<string, number> };

export async function collectCache(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const data = (await newapiGet(target, "/api/option/channel_affinity_cache")) as CacheStats | null;
  if (!data) return [];
  return [{
    task_id: task.id, target_id: target.id, metric: "cache_entries" as const,
    value: data.Total ?? 0, checked_at: now,
    meta: { Enabled: data.Enabled, Unknown: data.Unknown, ByRuleName: data.ByRuleName },
  }];
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `pnpm test tests/collectors/newapi-usage.test.ts tests/collectors/newapi-errors.test.ts tests/collectors/newapi-balance.test.ts tests/collectors/newapi-cache.test.ts`
Expected: usage 2 + errors 2 + balance 1 + cache 1 = 6 passed。

- [ ] **Step 9: 提交**

```bash
git add lib/collectors/newapi-usage.ts lib/collectors/newapi-errors.ts lib/collectors/newapi-balance.ts lib/collectors/newapi-cache.ts tests/collectors/newapi-usage.test.ts tests/collectors/newapi-errors.test.ts tests/collectors/newapi-balance.test.ts tests/collectors/newapi-cache.test.ts
git commit -m "feat(monitor): 拉取型采集器 usage/errors/balance/cache"
```

---

## Task 9: active_probe 采集器 + 分派器接线

**Files:**
- Create: `lib/collectors/active-probe.ts`
- Modify: `lib/collectors/index.ts`（Task 7 已写好内容，本任务一起提交并跑编译）
- Test: `tests/collectors/active-probe.test.ts`

**Interfaces:**
- Consumes: `checkWithAiSdk` (`lib/providers/ai-sdk-check`)，签名 `checkWithAiSdk(config: ProviderConfig): Promise<CheckResult>`，`CheckResult` 含 `status,latencyMs,pingLatencyMs`；类型 `ProviderConfig,ProviderType`；`SampleInput`；`MonitorTargetRow,MonitorTaskRow`。
- Produces: `collectProbe(target, task, now?): Promise<SampleInput[]>` — 用 `target.probe_api_key` 构造 `ProviderConfig`（format 取 `task.config.format` 默认 `"openai"`，model 取 `task.config.model`，endpoint 取 `task.config.endpoint` 默认 `target.base_url`），调用 `checkWithAiSdk`，产出 `reachable`(1/0)、`ttft_ms`(latencyMs)、`ping_ms`(pingLatencyMs)，dim_model=model。

- [ ] **Step 1: 写测试**

Create `tests/collectors/active-probe.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

const checkMock = vi.fn();
vi.mock("@/lib/providers/ai-sdk-check", () => ({ checkWithAiSdk: checkMock }));

import { collectProbe } from "@/lib/collectors/active-probe";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "supplier",
  admin_token: null, admin_user_id: null, probe_api_key: "sk-probe", group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "probe", collector_type: "active_probe",
  config: { model: "gpt-4o-mini", format: "openai" }, interval_seconds: 60,
  enabled: true, is_maintenance: false, next_run_at: null, last_run_at: null,
  last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => { checkMock.mockReset(); });

describe("collectProbe", () => {
  it("operational → reachable=1，含 ttft/ping", async () => {
    checkMock.mockResolvedValue({ status: "operational", latencyMs: 250, pingLatencyMs: 30, model: "gpt-4o-mini" });
    const samples = await collectProbe(target, task, "2026-06-28T00:00:00.000Z");
    const m = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(m.reachable).toBe(1);
    expect(m.ttft_ms).toBe(250);
    expect(m.ping_ms).toBe(30);
    expect(samples[0].dim_model).toBe("gpt-4o-mini");
  });

  it("failed → reachable=0，不产出 ttft", async () => {
    checkMock.mockResolvedValue({ status: "failed", latencyMs: null, pingLatencyMs: null, model: "gpt-4o-mini" });
    const samples = await collectProbe(target, task, "2026-06-28T00:00:00.000Z");
    const m = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(m.reachable).toBe(0);
    expect(m.ttft_ms).toBeUndefined();
  });

  it("缺少 probe_api_key 抛错", async () => {
    await expect(collectProbe({ ...target, probe_api_key: null }, task, "2026-06-28T00:00:00.000Z")).rejects.toThrow(/probe/i);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/collectors/active-probe.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

Create `lib/collectors/active-probe.ts`:

```typescript
import "server-only";
import { checkWithAiSdk } from "../providers/ai-sdk-check";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";
import type { ProviderConfig, ProviderType } from "../types/provider";

export async function collectProbe(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  if (!target.probe_api_key) throw new Error(`目标 ${target.name} 缺少 probe_api_key，无法实测`);
  const cfg = (task.config ?? {}) as { model?: string; format?: ProviderType; endpoint?: string };
  const model = cfg.model || "gpt-4o-mini";
  const providerConfig: ProviderConfig = {
    id: task.id,
    name: `${target.name}/${task.name}`,
    type: cfg.format || "openai",
    endpoint: cfg.endpoint || target.base_url,
    model,
    apiKey: target.probe_api_key,
    is_maintenance: false,
    groupName: target.group_name,
  };
  const result = await checkWithAiSdk(providerConfig);
  const reachable = result.status === "operational" || result.status === "degraded";
  const samples: SampleInput[] = [{
    task_id: task.id, target_id: target.id, metric: "reachable",
    dim_model: model, value: reachable ? 1 : 0, checked_at: now,
    meta: { status: result.status, message: result.message ?? null },
  }];
  if (typeof result.latencyMs === "number") {
    samples.push({ task_id: task.id, target_id: target.id, metric: "ttft_ms", dim_model: model, value: result.latencyMs, checked_at: now });
  }
  if (typeof result.pingLatencyMs === "number") {
    samples.push({ task_id: task.id, target_id: target.id, metric: "ping_ms", dim_model: model, value: result.pingLatencyMs, checked_at: now });
  }
  return samples;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/collectors/active-probe.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 确认分派器编译通过（index.ts 的 import 现已全部存在）**

Run: `pnpm exec tsc --noEmit`
Expected: 无与 `lib/collectors/*` 相关的报错。

- [ ] **Step 6: 提交**

```bash
git add lib/collectors/active-probe.ts lib/collectors/index.ts tests/collectors/active-probe.test.ts
git commit -m "feat(monitor): active_probe 采集器与采集器分派器"
```

---

## Task 10: 飞书卡片构造 + 签名 + 发送

**Files:**
- Create: `lib/alerting/feishu-card.ts`
- Test: `tests/alerting/feishu-card.test.ts`

**Interfaces:**
- Consumes: 类型 `AlertSeverity,AlertState`；`FeishuWebhookRow`。
- Produces:
  - `buildAlertCard(payload: AlertCardPayload): object`（飞书 interactive 卡片 JSON；颜色：info→blue / warning→orange / critical→red；resolved→green）
  - `signFeishu(secret: string, timestampSec: number): string`（飞书规范：`base64(HMAC_SHA256(key=timestamp+"\n"+secret, msg=""))`）
  - `sendFeishu(webhook: FeishuWebhookRow, card: object): Promise<void>`（POST，含签名时带 `timestamp`+`sign`；失败重试 1 次后抛错）
  - 类型 `AlertCardPayload = { state: AlertState; severity: AlertSeverity; ruleName: string; targetName: string; metric: string; currentValue: number; comparator: string; threshold: number; windowSeconds: number; firstSeenAt: string|null; link?: string }`

- [ ] **Step 1: 写测试**

Create `tests/alerting/feishu-card.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAlertCard, signFeishu, sendFeishu } from "@/lib/alerting/feishu-card";
import type { FeishuWebhookRow } from "@/lib/types/monitor";

afterEach(() => vi.restoreAllMocks());

describe("feishu-card", () => {
  it("firing+critical 卡片为红色并含关键字段", () => {
    const card = JSON.stringify(buildAlertCard({
      state: "firing", severity: "critical", ruleName: "错误激增", targetName: "Prod A",
      metric: "error_count", currentValue: 42, comparator: ">", threshold: 20,
      windowSeconds: 300, firstSeenAt: "2026-06-28T00:00:00.000Z",
    }));
    expect(card).toContain("red");
    expect(card).toContain("错误激增");
    expect(card).toContain("Prod A");
    expect(card).toContain("42");
  });

  it("resolved 卡片为绿色", () => {
    const card = JSON.stringify(buildAlertCard({
      state: "resolved", severity: "warning", ruleName: "R", targetName: "T",
      metric: "ttft_ms", currentValue: 100, comparator: ">", threshold: 6000,
      windowSeconds: 300, firstSeenAt: null,
    }));
    expect(card).toContain("green");
  });

  it("飞书签名稳定可复现", () => {
    const a = signFeishu("mysecret", 1700000000);
    const b = signFeishu("mysecret", 1700000000);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("sendFeishu 首次失败后重试成功", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const webhook: FeishuWebhookRow = {
      id: "w1", name: "W", webhook_url: "https://open.feishu.cn/hook/x", secret: null,
      group_name: null, created_at: "", updated_at: "",
    };
    await sendFeishu(webhook, { msg_type: "interactive", card: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sendFeishu 两次都失败则抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fail", { status: 500 })));
    const webhook: FeishuWebhookRow = {
      id: "w1", name: "W", webhook_url: "https://open.feishu.cn/hook/x", secret: null,
      group_name: null, created_at: "", updated_at: "",
    };
    await expect(sendFeishu(webhook, { msg_type: "interactive", card: {} })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/alerting/feishu-card.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

Create `lib/alerting/feishu-card.ts`:

```typescript
import "server-only";
import { createHmac } from "node:crypto";
import type { AlertSeverity, AlertState, FeishuWebhookRow } from "../types/monitor";

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  info: "blue", warning: "orange", critical: "red",
};

export type AlertCardPayload = {
  state: AlertState;
  severity: AlertSeverity;
  ruleName: string;
  targetName: string;
  metric: string;
  currentValue: number;
  comparator: string;
  threshold: number;
  windowSeconds: number;
  firstSeenAt: string | null;
  link?: string;
};

export function buildAlertCard(p: AlertCardPayload): object {
  const color = p.state === "resolved" ? "green" : SEVERITY_COLOR[p.severity];
  const title = p.state === "resolved"
    ? `✅ 已恢复：${p.ruleName}`
    : `🚨 告警：${p.ruleName}（${p.severity}）`;
  const lines = [
    `**目标**：${p.targetName}`,
    `**指标**：${p.metric}`,
    `**当前值**：${p.currentValue}（阈值 ${p.comparator} ${p.threshold}，窗口 ${p.windowSeconds}s）`,
    p.firstSeenAt ? `**首次发生**：${p.firstSeenAt}` : null,
    p.link ? `[查看详情](${p.link})` : null,
  ].filter(Boolean);
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: color, title: { tag: "plain_text", content: title } },
      elements: [{ tag: "div", text: { tag: "lark_md", content: lines.join("\n") } }],
    },
  };
}

export function signFeishu(secret: string, timestampSec: number): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

export async function sendFeishu(webhook: FeishuWebhookRow, card: object): Promise<void> {
  const body: Record<string, unknown> = { ...card };
  if (webhook.secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = signFeishu(webhook.secret, ts);
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(webhook.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`飞书 webhook HTTP ${res.status}`);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("飞书发送失败");
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/alerting/feishu-card.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/alerting/feishu-card.ts tests/alerting/feishu-card.test.ts
git commit -m "feat(monitor): 飞书告警卡片、签名与发送"
```

---

## Task 11: 告警引擎（规则评估 + 状态机）

**Files:**
- Create: `lib/alerting/engine.ts`
- Test: `tests/alerting/engine.test.ts`

**Interfaces:**
- Consumes: `listEnabledRules` (`lib/db/alert-rules`)；`aggregateWindow` (`lib/db/samples`)；`getEventByRule,upsertEvent` (`lib/db/alert-events`)；`getTarget` (`lib/db/targets`)；`resolveWebhook` (`lib/db/feishu`)；`buildAlertCard,sendFeishu` (`lib/alerting/feishu-card`)；`logError` (`lib/utils`)；类型 `Comparator,AlertRuleRow`。
- Produces:
  - `compare(value: number, comparator: Comparator, threshold: number): boolean`
  - `evaluateAlertRules(now?: string): Promise<{ fired: number; resolved: number }>`（遍历启用规则，逐条聚合→比较→跑状态机→必要时发飞书）

**状态机逻辑（精确）**：
- breached（达到阈值）且当前非 firing：`breach_count++`；当 `breach_count >= consecutive_breaches` → 置 `state='firing'`、发 firing 卡片、记 `last_notified_at`。未达连续次数则只累积不发。
- breached 且已 firing：不重发（去重）。
- not breached 且当前 firing：置 `state='resolved'`、`resolved_at=now`、发 resolved 卡片。
- not breached 且非 firing：`breach_count` 归零（重置累积）。
- 窗口聚合为 null（无样本）视为 not breached。
- 发飞书失败用 `logError` 记录，不中断其他规则；状态仍按逻辑推进（避免卡死），但 `last_notified_at` 仅在发送成功后更新。

- [ ] **Step 1: 写测试**

Create `tests/alerting/engine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { compare, evaluateAlertRules } from "@/lib/alerting/engine";
import { insertSamples } from "@/lib/db/samples";
import { getEventByRule } from "@/lib/db/alert-events";

const sendMock = vi.fn();
vi.mock("@/lib/alerting/feishu-card", async (orig) => {
  const actual = await orig<typeof import("@/lib/alerting/feishu-card")>();
  return { ...actual, sendFeishu: (...a: unknown[]) => sendMock(...a) };
});

function seed() {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("t1","Prod A","http://x","self","生产",now,now);
  db.prepare("INSERT INTO feishu_webhooks (id,name,webhook_url,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("w1","default","http://hook",null,now,now);
  __setDbForTest(db);
  return db;
}

function addRule(db: any, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const r = {
    id: "r1", name: "错误激增", target_id: "t1", task_id: null, metric: "error_count",
    comparator: ">", threshold: 10, window_seconds: 300, aggregation: "sum",
    consecutive_breaches: 1, severity: "critical", feishu_webhook_id: null, enabled: 1, ...over,
  };
  db.prepare(`INSERT INTO alert_rules (id,name,target_id,task_id,metric,comparator,threshold,window_seconds,aggregation,consecutive_breaches,severity,feishu_webhook_id,enabled,created_at,updated_at)
    VALUES (@id,@name,@target_id,@task_id,@metric,@comparator,@threshold,@window_seconds,@aggregation,@consecutive_breaches,@severity,@feishu_webhook_id,@enabled,'${now}','${now}')`).run(r);
  return r.id;
}

let db: any;
beforeEach(() => { db = seed(); sendMock.mockReset(); sendMock.mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

describe("compare", () => {
  it("各比较算子", () => {
    expect(compare(5, ">", 3)).toBe(true);
    expect(compare(2, "<", 3)).toBe(true);
    expect(compare(3, ">=", 3)).toBe(true);
    expect(compare(3, "==", 3)).toBe(true);
    expect(compare(2, ">", 3)).toBe(false);
  });
});

describe("evaluateAlertRules 状态机", () => {
  it("超阈值且 consecutive=1 → firing 并发一次飞书", async () => {
    addRule(db);
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 8, checked_at: now },
      { task_id: null, target_id: "t1", metric: "error_count", value: 7, checked_at: now },
    ]);
    const res = await evaluateAlertRules(now);
    expect(res.fired).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await getEventByRule("r1"))?.state).toBe("firing");
  });

  it("firing 后再次超阈值不重发（去重）", async () => {
    addRule(db);
    const now = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: now }]);
    await evaluateAlertRules(now);
    sendMock.mockClear();
    await evaluateAlertRules(new Date().toISOString());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("恢复时发 resolved 卡片", async () => {
    addRule(db);
    const t1 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t1 }]);
    await evaluateAlertRules(t1);
    sendMock.mockClear();
    // 之后窗口无新样本 → not breached → resolved
    const later = new Date(Date.now() + 400_000).toISOString();
    const res = await evaluateAlertRules(later);
    expect(res.resolved).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await getEventByRule("r1"))?.state).toBe("resolved");
  });

  it("consecutive_breaches=2：首轮只累积不发，次轮才 firing", async () => {
    addRule(db, { consecutive_breaches: 2 });
    const t1 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t1 }]);
    const r1 = await evaluateAlertRules(t1);
    expect(r1.fired).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
    const t2 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t2 }]);
    const r2 = await evaluateAlertRules(t2);
    expect(r2.fired).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/alerting/engine.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写实现**

Create `lib/alerting/engine.ts`:

```typescript
import "server-only";
import { nowIso } from "../db/json";
import { listEnabledRules } from "../db/alert-rules";
import { aggregateWindow } from "../db/samples";
import { getEventByRule, upsertEvent } from "../db/alert-events";
import { getTarget } from "../db/targets";
import { resolveWebhook } from "../db/feishu";
import { buildAlertCard, sendFeishu } from "./feishu-card";
import { logError } from "../utils";
import type { AlertRuleRow, Comparator } from "../types/monitor";

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    case "==": return value === threshold;
    default: return false;
  }
}

async function notify(rule: AlertRuleRow, state: "firing" | "resolved", value: number, firstSeenAt: string | null): Promise<boolean> {
  const target = rule.target_id ? await getTarget(rule.target_id) : null;
  const webhook = await resolveWebhook({ webhookId: rule.feishu_webhook_id, groupName: target?.group_name ?? null });
  if (!webhook) {
    logError(`告警规则 ${rule.name} 无可用飞书 webhook`, new Error("no webhook"));
    return false;
  }
  const card = buildAlertCard({
    state, severity: rule.severity, ruleName: rule.name, targetName: target?.name ?? "全局",
    metric: rule.metric, currentValue: value, comparator: rule.comparator, threshold: rule.threshold,
    windowSeconds: rule.window_seconds, firstSeenAt,
  });
  try {
    await sendFeishu(webhook, card);
    return true;
  } catch (err) {
    logError(`告警规则 ${rule.name} 飞书发送失败`, err);
    return false;
  }
}

export async function evaluateAlertRules(now: string = nowIso()): Promise<{ fired: number; resolved: number }> {
  const rules = await listEnabledRules();
  let fired = 0;
  let resolved = 0;
  for (const rule of rules) {
    try {
      const since = new Date(Date.parse(now) - rule.window_seconds * 1000).toISOString();
      const value = await aggregateWindow({
        targetId: rule.target_id, taskId: rule.task_id, metric: rule.metric,
        sinceIso: since, aggregation: rule.aggregation,
      });
      const breached = value !== null && compare(value, rule.comparator, rule.threshold);
      const event = await getEventByRule(rule.id);
      const isFiring = event?.state === "firing";

      if (breached && !isFiring) {
        const nextCount = (event?.breach_count ?? 0) + 1;
        if (nextCount >= rule.consecutive_breaches) {
          const firstSeen = event?.first_seen_at ?? now;
          const sent = await notify(rule, "firing", value!, firstSeen);
          await upsertEvent(rule.id, {
            state: "firing", breach_count: nextCount, first_seen_at: firstSeen,
            last_seen_at: now, resolved_at: null,
            last_notified_at: sent ? now : (event?.last_notified_at ?? null),
            message: `${rule.metric}=${value} ${rule.comparator} ${rule.threshold}`,
          });
          fired++;
        } else {
          await upsertEvent(rule.id, { breach_count: nextCount, first_seen_at: event?.first_seen_at ?? now, last_seen_at: now });
        }
      } else if (breached && isFiring) {
        await upsertEvent(rule.id, { last_seen_at: now });
      } else if (!breached && isFiring) {
        await notify(rule, "resolved", value ?? 0, event?.first_seen_at ?? null);
        await upsertEvent(rule.id, { state: "resolved", breach_count: 0, resolved_at: now, last_seen_at: now });
        resolved++;
      } else if (!breached && event && event.breach_count > 0) {
        await upsertEvent(rule.id, { breach_count: 0 });
      }
    } catch (err) {
      logError(`评估告警规则 ${rule.name} 失败`, err);
    }
  }
  return { fired, resolved };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/alerting/engine.test.ts`
Expected: compare 1 + 状态机 4 = 5 passed。

- [ ] **Step 5: 提交**

```bash
git add lib/alerting/engine.ts tests/alerting/engine.test.ts
git commit -m "feat(monitor): 告警引擎（规则评估与状态机）"
```

---

## Task 12: 监控运行器 + 接入轮询器

**Files:**
- Create: `lib/core/monitor-runner.ts`
- Modify: `lib/core/poller.ts`（`tick()` 末尾、`logFailedResultsByGroup` 之后调用 `runMonitorOnce()`）
- Test: `tests/integration/monitor-runner.test.ts`

**Interfaces:**
- Consumes: `getDueTasks,recordTaskRun` (`lib/db/monitor-tasks`)；`getTarget` (`lib/db/targets`)；`runCollector,SkipCollector` (`lib/collectors`)；`insertSamples` (`lib/db/samples`)；`evaluateAlertRules` (`lib/alerting/engine`)；`cleanupSamples` (`lib/db/samples`)；`logError` (`lib/utils`)；`pLimit` (`p-limit`)；`getCheckConcurrency` (`lib/core/polling-config`)。
- Produces:
  - `runMonitorOnce(now?: string): Promise<{ ran: number; samples: number; fired: number; resolved: number }>`（取到期任务→并发采集→写样本→回写调度→评估告警→偶发清理）

**逻辑**：
- 取 `getDueTasks(now)`；对每个任务，`getTarget(task.target_id)`（target 不存在或 disabled 则跳过）；`pLimit(getCheckConcurrency())` 并发执行 `runCollector`。
- 成功：`insertSamples(result)`，`recordTaskRun(task.id, "ok", null, next)`，`next = now + interval_seconds`。
- `SkipCollector`：`recordTaskRun(task.id, "skipped", err.message, next)`，不写样本。
- 其他异常：`recordTaskRun(task.id, "failed", message, next)`，`logError`。
- 全部任务跑完后 `evaluateAlertRules(now)`。
- 清理：仅当 `samples` 写入发生时按 `MONITOR_RETENTION_DAYS`（默认取 `HISTORY_RETENTION_DAYS`，再默认 30）调用 `cleanupSamples`。

- [ ] **Step 1: 写集成测试**

Create `tests/integration/monitor-runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { createTask, getTask } from "@/lib/db/monitor-tasks";
import { latestSamples } from "@/lib/db/samples";

const checkMock = vi.fn();
vi.mock("@/lib/providers/ai-sdk-check", () => ({ checkWithAiSdk: checkMock }));

import { runMonitorOnce } from "@/lib/core/monitor-runner";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
  checkMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("runMonitorOnce", () => {
  it("执行到期的 active_probe 任务并写样本、顺延调度", async () => {
    checkMock.mockResolvedValue({ status: "operational", latencyMs: 200, pingLatencyMs: 20, model: "gpt-4o-mini" });
    const target = await createTarget({
      name: "供应商", base_url: "https://s.example.com", kind: "supplier",
      admin_token: null, admin_user_id: null, probe_api_key: "sk-x", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: target.id, name: "probe", collector_type: "active_probe",
      config: { model: "gpt-4o-mini" }, interval_seconds: 60, enabled: true, is_maintenance: false,
    });
    const res = await runMonitorOnce(new Date().toISOString());
    expect(res.ran).toBe(1);
    expect(res.samples).toBeGreaterThanOrEqual(1);
    const reach = await latestSamples(target.id, "reachable", 1);
    expect(reach[0].value).toBe(1);
    const after = await getTask(task.id);
    expect(after?.last_status).toBe("ok");
    expect(Date.parse(after!.next_run_at!)).toBeGreaterThan(Date.now());
  });

  it("供应商目标的 newapi_usage 任务被标记 skipped", async () => {
    const target = await createTarget({
      name: "供应商", base_url: "https://s.example.com", kind: "supplier",
      admin_token: null, admin_user_id: null, probe_api_key: "sk-x", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: target.id, name: "usage", collector_type: "newapi_usage",
      config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
    });
    await runMonitorOnce(new Date().toISOString());
    expect((await getTask(task.id))?.last_status).toBe("skipped");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/integration/monitor-runner.test.ts`
Expected: FAIL（找不到模块 `@/lib/core/monitor-runner`）。

- [ ] **Step 3: 写运行器实现**

Create `lib/core/monitor-runner.ts`:

```typescript
import pLimit from "p-limit";
import { nowIso } from "../db/json";
import { getDueTasks, recordTaskRun } from "../db/monitor-tasks";
import { getTarget } from "../db/targets";
import { insertSamples, cleanupSamples } from "../db/samples";
import { runCollector, SkipCollector } from "../collectors";
import { evaluateAlertRules } from "../alerting/engine";
import { getErrorMessage, logError } from "../utils";
import { getCheckConcurrency } from "./polling-config";

function retentionDays(): number {
  const raw = process.env.MONITOR_RETENTION_DAYS ?? process.env.HISTORY_RETENTION_DAYS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function runMonitorOnce(now: string = nowIso()): Promise<{ ran: number; samples: number; fired: number; resolved: number }> {
  const tasks = await getDueTasks(now);
  const limit = pLimit(getCheckConcurrency());
  let sampleCount = 0;
  let ran = 0;

  await Promise.all(tasks.map((task) => limit(async () => {
    const next = new Date(Date.parse(now) + task.interval_seconds * 1000).toISOString();
    const target = await getTarget(task.target_id);
    if (!target || !target.enabled) {
      await recordTaskRun(task.id, "skipped", "目标不存在或已禁用", next);
      return;
    }
    try {
      const samples = await runCollector(target, task);
      await insertSamples(samples);
      sampleCount += samples.length;
      ran++;
      await recordTaskRun(task.id, "ok", null, next);
    } catch (err) {
      if (err instanceof SkipCollector) {
        await recordTaskRun(task.id, "skipped", err.message, next);
        return;
      }
      logError(`监控任务 ${task.name} 采集失败`, err);
      await recordTaskRun(task.id, "failed", getErrorMessage(err), next);
    }
  })));

  let fired = 0;
  let resolved = 0;
  try {
    const r = await evaluateAlertRules(now);
    fired = r.fired;
    resolved = r.resolved;
  } catch (err) {
    logError("告警评估失败", err);
  }

  if (sampleCount > 0) {
    try {
      await cleanupSamples(retentionDays());
    } catch (err) {
      logError("清理监控样本失败", err);
    }
  }

  return { ran, samples: sampleCount, fired, resolved };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test tests/integration/monitor-runner.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 接入轮询器（修改 `lib/core/poller.ts`）**

在 `lib/core/poller.ts` 顶部 import 区加：

```typescript
import { runMonitorOnce } from "./monitor-runner";
```

在 `tick()` 函数体内、`logFailedResultsByGroup(results);`（约第 116 行）之后、`catch` 之前加：

```typescript
    try {
      const monitorResult = await runMonitorOnce();
      if (monitorResult.ran > 0 || monitorResult.fired > 0 || monitorResult.resolved > 0) {
        console.log(
          `[check-cx] newapi 监控：执行 ${monitorResult.ran} 任务，写入 ${monitorResult.samples} 样本，` +
          `告警 firing=${monitorResult.fired} resolved=${monitorResult.resolved}`
        );
      }
    } catch (error) {
      console.error("[check-cx] newapi 监控执行失败", error);
    }
```

- [ ] **Step 6: 运行全量测试，确认无回归**

Run: `pnpm test`
Expected: 现有测试 + 新增测试全部 passed。

- [ ] **Step 7: 提交**

```bash
git add lib/core/monitor-runner.ts lib/core/poller.ts tests/integration/monitor-runner.test.ts
git commit -m "feat(monitor): 监控运行器并接入后台轮询器"
```

---

## Task 13: 对外只读监控 API

**Files:**
- Create: `lib/core/monitor-dashboard.ts`（聚合读取，供 API 与页面复用）, `app/api/monitor/targets/route.ts`, `app/api/monitor/targets/[id]/route.ts`, `app/api/monitor/metrics/route.ts`
- Test: `tests/integration/monitor-dashboard.test.ts`

**Interfaces:**
- Consumes: `listTargets,getTarget` (`lib/db/targets`)；`latestSamples,querySeries` (`lib/db/samples`)；`listTasks` (`lib/db/monitor-tasks`)；`maskSecret` (`lib/db/monitor-crypto`)；类型 `MetricName`。
- Produces:
  - `getTargetsOverview(): Promise<TargetOverview[]>`（每目标：基础信息（token/key 脱敏）+ 最新 reachable/ttft_ms/error_count）
  - `getTargetDetail(id): Promise<TargetDetail | null>`（目标 + 任务列表（不含密钥）+ 各指标最新值 + 模型用量 TOP + 渠道余额表）
  - 类型 `TargetOverview`、`TargetDetail`
  - 3 个 route：均 `dynamic="force-dynamic"`，返回 JSON，设 `Cache-Control: public, no-cache`。

- [ ] **Step 1: 写测试**

Create `tests/integration/monitor-dashboard.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { insertSamples } from "@/lib/db/samples";
import { getTargetsOverview, getTargetDetail } from "@/lib/core/monitor-dashboard";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

describe("monitor-dashboard", () => {
  it("overview 含最新 reachable，且不泄露明文密钥", async () => {
    const t = await createTarget({
      name: "T", base_url: "http://x", kind: "self", admin_token: "acc-secret",
      admin_user_id: "1", probe_api_key: "sk-secret", group_name: "g", enabled: true,
    });
    await insertSamples([{ task_id: null, target_id: t.id, metric: "reachable", value: 1, checked_at: new Date().toISOString() }]);
    const ov = await getTargetsOverview();
    expect(ov[0].reachable).toBe(1);
    expect(JSON.stringify(ov)).not.toContain("acc-secret");
    expect(JSON.stringify(ov)).not.toContain("sk-secret");
  });

  it("getTargetDetail 不存在返回 null", async () => {
    expect(await getTargetDetail("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/integration/monitor-dashboard.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 写聚合读取模块**

Create `lib/core/monitor-dashboard.ts`:

```typescript
import "server-only";
import { listTargets, getTarget } from "../db/targets";
import { latestSamples } from "../db/samples";
import { listTasks } from "../db/monitor-tasks";
import type { MetricName } from "../types/monitor";

async function latestValue(targetId: string, metric: MetricName): Promise<number | null> {
  const rows = await latestSamples(targetId, metric, 1);
  return rows.length > 0 ? rows[0].value : null;
}

export type TargetOverview = {
  id: string; name: string; kind: string; group_name: string | null; enabled: boolean;
  reachable: number | null; ttft_ms: number | null; error_count: number | null;
};

export async function getTargetsOverview(): Promise<TargetOverview[]> {
  const targets = await listTargets();
  return Promise.all(targets.map(async (t) => ({
    id: t.id, name: t.name, kind: t.kind, group_name: t.group_name, enabled: t.enabled,
    reachable: await latestValue(t.id, "reachable"),
    ttft_ms: await latestValue(t.id, "ttft_ms"),
    error_count: await latestValue(t.id, "error_count"),
  })));
}

export type TargetDetail = {
  id: string; name: string; kind: string; base_url: string; group_name: string | null;
  tasks: Array<{ id: string; name: string; collector_type: string; last_status: string | null; last_run_at: string | null; last_error: string | null }>;
  metrics: Record<string, number | null>;
  channelBalances: Array<{ channel: string | null; value: number; name: string | null }>;
};

export async function getTargetDetail(id: string): Promise<TargetDetail | null> {
  const t = await getTarget(id);
  if (!t) return null;
  const tasks = await listTasks(id);
  const balances = await latestSamples(id, "channel_balance", 100);
  return {
    id: t.id, name: t.name, kind: t.kind, base_url: t.base_url, group_name: t.group_name,
    tasks: tasks.map((k) => ({
      id: k.id, name: k.name, collector_type: k.collector_type,
      last_status: k.last_status, last_run_at: k.last_run_at, last_error: k.last_error,
    })),
    metrics: {
      reachable: await latestValue(id, "reachable"),
      ttft_ms: await latestValue(id, "ttft_ms"),
      ping_ms: await latestValue(id, "ping_ms"),
      error_count: await latestValue(id, "error_count"),
      cache_entries: await latestValue(id, "cache_entries"),
    },
    channelBalances: balances.map((b) => ({
      channel: b.dim_channel, value: b.value,
      name: (b.meta as { name?: string } | null)?.name ?? null,
    })),
  };
}
```

- [ ] **Step 4: 写 3 个 API 路由**

Create `app/api/monitor/targets/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getTargetsOverview } from "@/lib/core/monitor-dashboard";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTargetsOverview();
  return NextResponse.json(data, { headers: { "Cache-Control": "public, no-cache" } });
}
```

Create `app/api/monitor/targets/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getTargetDetail } from "@/lib/core/monitor-dashboard";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getTargetDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "public, no-cache" } });
}
```

Create `app/api/monitor/metrics/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { querySeries } from "@/lib/db/samples";
import type { MetricName } from "@/lib/types/monitor";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("target");
  const metric = searchParams.get("metric") as MetricName | null;
  if (!target || !metric) {
    return NextResponse.json({ error: "target 和 metric 必填" }, { status: 400 });
  }
  const to = searchParams.get("to") ?? new Date().toISOString();
  const from = searchParams.get("from") ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const series = await querySeries(target, metric, from, to);
  return NextResponse.json(series, { headers: { "Cache-Control": "public, no-cache" } });
}
```

- [ ] **Step 5: 运行测试 + 编译，确认通过**

Run: `pnpm test tests/integration/monitor-dashboard.test.ts && pnpm exec tsc --noEmit`
Expected: 2 passed；tsc 无 monitor 相关报错。

- [ ] **Step 6: 提交**

```bash
git add lib/core/monitor-dashboard.ts app/api/monitor tests/integration/monitor-dashboard.test.ts
git commit -m "feat(monitor): 对外只读监控 API 与聚合读取"
```

---

## Task 14: 后台管理 Server Actions（targets / tasks / alerts / webhooks）

**Files:**
- Create: `app/admin/(protected)/targets/actions.ts`, `app/admin/(protected)/monitor-tasks/actions.ts`, `app/admin/(protected)/alerts/actions.ts`, `app/admin/(protected)/webhooks/actions.ts`
- Test: `tests/integration/monitor-actions.test.ts`（直接测试 DB 层组合逻辑：测试连通性 + webhook 测试发送的纯函数部分）

**Interfaces:**
- Consumes: `requireAppUser` (`lib/admin/auth`)；`isAdminUser` (`lib/admin/permissions`)；`requiredString,optionalString,booleanFromForm` (`lib/admin/forms`)；各 DB 层 CRUD（Task 3/4/6）；`runCollector` 间接不用——连通性测试用 `newapiGet`/`collectProbe`；`sendFeishu,buildAlertCard` (`lib/alerting/feishu-card`)；`revalidatePath`,`redirect`。
- Produces（每个 actions.ts 导出对应 `create*Action`/`update*Action`/`delete*Action`，签名 `(formData: FormData) => Promise<void>`，遵循现有 actions.ts 模式：解析表单→调 DB 层→`revalidatePath`→`redirect`）：
  - targets：`createTargetAction`,`updateTargetAction`,`deleteTargetAction`,`testTargetConnectionAction`（self→`newapiGet(target,"/api/status")` 或 probe；supplier→`collectProbe`）。
  - monitor-tasks：`createTaskAction`,`updateTaskAction`,`deleteTaskAction`,`toggleTaskMaintenanceAction`。
  - alerts：`createRuleAction`,`updateRuleAction`,`deleteRuleAction`。
  - webhooks：`createWebhookAction`,`updateWebhookAction`,`deleteWebhookAction`,`testWebhookAction`（构造测试卡片 `sendFeishu`）。
- 权限：所有 action 开头 `const user = await requireAppUser(); if (!isAdminUser(user)) redirect("/admin")`（沿用现有约定）。

- [ ] **Step 1: 写测试（针对可单测的纯逻辑：表单解析 helper）**

Create `tests/integration/monitor-actions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTaskConfig, parseRuleNumbers } from "@/app/admin/(protected)/monitor-tasks/form-utils";

describe("monitor 表单解析", () => {
  it("parseTaskConfig 把 model/format/endpoint 收进 config 对象", () => {
    const fd = new FormData();
    fd.set("model", "gpt-4o-mini");
    fd.set("format", "openai");
    fd.set("endpoint", "");
    expect(parseTaskConfig(fd)).toEqual({ model: "gpt-4o-mini", format: "openai" });
  });

  it("parseRuleNumbers 解析阈值/窗口/连续次数", () => {
    const fd = new FormData();
    fd.set("threshold", "20");
    fd.set("window_seconds", "300");
    fd.set("consecutive_breaches", "2");
    expect(parseRuleNumbers(fd)).toEqual({ threshold: 20, window_seconds: 300, consecutive_breaches: 2 });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test tests/integration/monitor-actions.test.ts`
Expected: FAIL（找不到模块 `form-utils`）。

- [ ] **Step 3: 写表单解析工具（被 actions 与测试共用）**

Create `app/admin/(protected)/monitor-tasks/form-utils.ts`:

```typescript
export function parseTaskConfig(formData: FormData): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const model = formData.get("model")?.toString().trim();
  const format = formData.get("format")?.toString().trim();
  const endpoint = formData.get("endpoint")?.toString().trim();
  if (model) config.model = model;
  if (format) config.format = format;
  if (endpoint) config.endpoint = endpoint;
  return config;
}

export function parseRuleNumbers(formData: FormData): { threshold: number; window_seconds: number; consecutive_breaches: number } {
  return {
    threshold: Number(formData.get("threshold") ?? 0),
    window_seconds: Number(formData.get("window_seconds") ?? 0),
    consecutive_breaches: Number(formData.get("consecutive_breaches") ?? 1),
  };
}
```

- [ ] **Step 4: 写 targets actions（其余三个 actions 同构，按下方逐一创建）**

Create `app/admin/(protected)/targets/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createTarget, updateTarget, deleteTarget, getTarget } from "@/lib/db/targets";
import { newapiGet } from "@/lib/collectors/newapi-client";
import { collectProbe } from "@/lib/collectors/active-probe";
import type { TargetKind } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}

function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }

export async function createTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createTarget({
    name: str(formData, "name"),
    base_url: str(formData, "base_url"),
    kind: (str(formData, "kind") || "self") as TargetKind,
    admin_token: optStr(formData, "admin_token"),
    admin_user_id: optStr(formData, "admin_user_id"),
    probe_api_key: optStr(formData, "probe_api_key"),
    group_name: optStr(formData, "group_name"),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  });
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function updateTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const id = str(formData, "id");
  const patch: Record<string, unknown> = {
    name: str(formData, "name"),
    base_url: str(formData, "base_url"),
    kind: (str(formData, "kind") || "self") as TargetKind,
    admin_user_id: optStr(formData, "admin_user_id"),
    group_name: optStr(formData, "group_name"),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  };
  // 仅当用户填写了新值时才覆盖密钥（留空表示不修改）
  const newToken = optStr(formData, "admin_token");
  if (newToken) patch.admin_token = newToken;
  const newKey = optStr(formData, "probe_api_key");
  if (newKey) patch.probe_api_key = newKey;
  await updateTarget(id, patch as never);
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function deleteTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteTarget(str(formData, "id"));
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function testTargetConnectionAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const id = str(formData, "id");
  const target = await getTarget(id);
  if (!target) redirect("/admin/targets?error=目标不存在");
  let ok = false;
  let message = "";
  try {
    if (target!.kind === "self") {
      await newapiGet(target!, "/api/status");
      ok = true;
    } else {
      const samples = await collectProbe(target!, {
        id: "test", target_id: id, name: "test", collector_type: "active_probe",
        config: , interval_seconds: 60, enabled: true, is_maintenance: false,
        next_run_at: null, last_run_at: null, last_status: null, last_error: null,
        created_at: "", updated_at: "",
      });
      ok = samples.some((s) => s.metric === "reachable" && s.value === 1);
    }
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  redirect(`/admin/targets?${ok ? "success=连通正常" : `error=${encodeURIComponent("连通失败：" + message)}`}`);
}
```

- [ ] **Step 5: 写 monitor-tasks / alerts / webhooks actions**

Create `app/admin/(protected)/monitor-tasks/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createTask, updateTask, deleteTask } from "@/lib/db/monitor-tasks";
import { parseTaskConfig } from "./form-utils";
import type { CollectorType } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function bool(fd: FormData, k: string): boolean { const v = fd.get(k); return v === "on" || v === "true"; }

export async function createTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createTask({
    target_id: str(formData, "target_id"),
    name: str(formData, "name"),
    collector_type: str(formData, "collector_type") as CollectorType,
    config: parseTaskConfig(formData),
    interval_seconds: Number(formData.get("interval_seconds") ?? 300),
    enabled: bool(formData, "enabled"),
    is_maintenance: bool(formData, "is_maintenance"),
  });
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateTask(str(formData, "id"), {
    name: str(formData, "name"),
    collector_type: str(formData, "collector_type") as CollectorType,
    config: parseTaskConfig(formData),
    interval_seconds: Number(formData.get("interval_seconds") ?? 300),
    enabled: bool(formData, "enabled"),
    is_maintenance: bool(formData, "is_maintenance"),
  });
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteTask(str(formData, "id"));
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}
```

Create `app/admin/(protected)/alerts/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createRule, updateRule, deleteRule } from "@/lib/db/alert-rules";
import { parseRuleNumbers } from "../monitor-tasks/form-utils";
import type { MetricName, Comparator, Aggregation, AlertSeverity } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }
function bool(fd: FormData, k: string): boolean { const v = fd.get(k); return v === "on" || v === "true"; }

function buildRuleInput(fd: FormData) {
  const nums = parseRuleNumbers(fd);
  return {
    name: str(fd, "name"),
    target_id: optStr(fd, "target_id"),
    task_id: optStr(fd, "task_id"),
    metric: str(fd, "metric") as MetricName,
    comparator: str(fd, "comparator") as Comparator,
    threshold: nums.threshold,
    window_seconds: nums.window_seconds,
    aggregation: str(fd, "aggregation") as Aggregation,
    consecutive_breaches: nums.consecutive_breaches,
    severity: (str(fd, "severity") || "warning") as AlertSeverity,
    feishu_webhook_id: optStr(fd, "feishu_webhook_id"),
    enabled: bool(fd, "enabled"),
  };
}

export async function createRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createRule(buildRuleInput(formData));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}

export async function updateRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateRule(str(formData, "id"), buildRuleInput(formData));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteRule(str(formData, "id"));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}
```

Create `app/admin/(protected)/webhooks/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createWebhook, updateWebhook, deleteWebhook, getWebhook } from "@/lib/db/feishu";
import { buildAlertCard, sendFeishu } from "@/lib/alerting/feishu-card";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }

export async function createWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createWebhook({
    name: str(formData, "name"),
    webhook_url: str(formData, "webhook_url"),
    secret: optStr(formData, "secret"),
    group_name: optStr(formData, "group_name"),
  });
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function updateWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateWebhook(str(formData, "id"), {
    name: str(formData, "name"),
    webhook_url: str(formData, "webhook_url"),
    secret: optStr(formData, "secret"),
    group_name: optStr(formData, "group_name"),
  });
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteWebhook(str(formData, "id"));
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function testWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const webhook = await getWebhook(str(formData, "id"));
  if (!webhook) redirect("/admin/webhooks?error=webhook 不存在");
  let ok = false; let message = "";
  try {
    await sendFeishu(webhook!, buildAlertCard({
      state: "firing", severity: "info", ruleName: "测试通知", targetName: "（测试）",
      metric: "test", currentValue: 1, comparator: ">", threshold: 0, windowSeconds: 0, firstSeenAt: new Date().toISOString(),
    }));
    ok = true;
  } catch (err) { message = err instanceof Error ? err.message : String(err); }
  redirect(`/admin/webhooks?${ok ? "success=测试已发送" : `error=${encodeURIComponent("发送失败：" + message)}`}`);
}
```

- [ ] **Step 6: 运行测试 + 编译**

Run: `pnpm test tests/integration/monitor-actions.test.ts && pnpm exec tsc --noEmit`
Expected: 2 passed；tsc 无 monitor 相关报错。

- [ ] **Step 7: 提交**

```bash
git add "app/admin/(protected)/targets/actions.ts" "app/admin/(protected)/monitor-tasks/actions.ts" "app/admin/(protected)/monitor-tasks/form-utils.ts" "app/admin/(protected)/alerts/actions.ts" "app/admin/(protected)/webhooks/actions.ts" tests/integration/monitor-actions.test.ts
git commit -m "feat(monitor): 后台 targets/tasks/alerts/webhooks Server Actions"
```

---

## Task 15: 后台管理页面 + 公开看板区块

**Files:**
- Create: `app/admin/(protected)/targets/page.tsx`, `app/admin/(protected)/targets/new/page.tsx`, `app/admin/(protected)/targets/[id]/page.tsx`, `app/admin/(protected)/monitor-tasks/page.tsx`, `app/admin/(protected)/monitor-tasks/new/page.tsx`, `app/admin/(protected)/alerts/page.tsx`, `app/admin/(protected)/alerts/new/page.tsx`, `app/admin/(protected)/webhooks/page.tsx`, `app/admin/(protected)/webhooks/new/page.tsx`, `app/admin/(protected)/alert-events/page.tsx`
- Create: `components/monitor/targets-section.tsx`（公开看板区块，客户端组件，拉 `/api/monitor/targets`）
- Modify: `app/admin/(protected)/page.tsx`（在 `quickLinks` 数组追加 4 个入口）, `app/page.tsx`（渲染 `<TargetsSection />`）
- Test: 无新增单元测试（页面为展示层）；以 `pnpm build` 作为验收。

**Interfaces:**
- Consumes: Task 14 的 actions；DB 层 list 函数（`listTargets`,`listTasks`,`listRules`,`listWebhooks`,`listRecentEvents`）；`maskSecret`；现有 UI 组件（`PageHeader`,`Card`,`Badge`,`Button`，见 `components/admin/*`、`components/ui/*`）。
- Produces: 管理页面与公开区块。所有 list 页 server component，调用 `requireAppUser()` + `isAdminUser` 守卫；列表渲染表格 + 指向 `new`/编辑/删除表单按钮，复用 `app/admin/(protected)/configs/page.tsx` 的结构。

**实现指引（每个 list 页遵循同一骨架，以 targets 为范例）**：

```tsx
// app/admin/(protected)/targets/page.tsx
import { PageHeader } from "@/components/admin/page-header";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { redirect } from "next/navigation";
import { listTargets } from "@/lib/db/targets";
import { maskSecret } from "@/lib/db/monitor-crypto";
import Link from "next/link";
import { deleteTargetAction, testTargetConnectionAction } from "./actions";

export default async function TargetsPage() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
  const targets = await listTargets();
  return (
    <div className="space-y-6">
      <PageHeader title="监控目标" description="管理被监控的 newapi 实例（自有 / 供应商）。" />
      <Link href="/admin/targets/new" className="underline">新增目标</Link>
      <table className="w-full text-sm">
        <thead><tr><th>名称</th><th>类型</th><th>Base URL</th><th>Token</th><th>分组</th><th>操作</th></tr></thead>
        <tbody>
          {targets.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.kind}</td>
              <td>{t.base_url}</td>
              <td>{maskSecret(t.admin_token)}</td>
              <td>{t.group_name ?? "-"}</td>
              <td className="flex gap-2">
                <form action={testTargetConnectionAction}><input type="hidden" name="id" value={t.id} /><button>测试连通</button></form>
                <Link href={`/admin/targets/${t.id}`}>编辑</Link>
                <form action={deleteTargetAction}><input type="hidden" name="id" value={t.id} /><button>删除</button></form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

其余页面按同骨架实现：
- `targets/new/page.tsx`、`targets/[id]/page.tsx`：表单 `<form action={createTargetAction|updateTargetAction}>`，字段 name/base_url/kind(select self|supplier)/admin_token/admin_user_id/probe_api_key/group_name/enabled。编辑页密钥字段 placeholder「留空表示不修改」。
- `monitor-tasks/page.tsx` + `new`：列表展示 target/采集类型/周期/last_status/last_error；表单字段 target_id(select)/name/collector_type(select：供应商目标仅 active_probe)/model/format/endpoint/interval_seconds/enabled/is_maintenance。
- `alerts/page.tsx` + `new`：列表展示 name/metric/comparator/threshold/window/severity；表单字段见 `buildRuleInput` 所需。
- `webhooks/page.tsx` + `new`：列表展示 name/url(脱敏可选)/group；含「发送测试」表单按钮（`testWebhookAction`）。
- `alert-events/page.tsx`：调 `listRecentEvents(100)`，展示 rule_id/state/first_seen_at/resolved_at/message 时间线（只读）。

公开看板区块 `components/monitor/targets-section.tsx`（`"use client"`）：`useEffect` + `setInterval` 拉 `/api/monitor/targets`，渲染卡片网格（名称、可用性灯：reachable=1 绿/0 红、ttft_ms、error_count），点击卡片 `Link` 到 `/targets/[id]`（可选详情页，本任务先做区块，详情页复用 `/api/monitor/targets/[id]`）。

`app/admin/(protected)/page.tsx` 的 `quickLinks` 追加：

```typescript
  { title: "监控目标", description: "管理被监控的 newapi 实例。", href: "/admin/targets" },
  { title: "监控任务", description: "配置采集任务与周期。", href: "/admin/monitor-tasks" },
  { title: "告警规则", description: "阈值规则与飞书路由。", href: "/admin/alerts" },
  { title: "飞书 webhook", description: "告警通知机器人。", href: "/admin/webhooks" },
```

- [ ] **Step 1: 创建上述全部页面文件**（按骨架逐个填充字段，参照 `app/admin/(protected)/configs/` 现有页面的导入与样式）

- [ ] **Step 2: 修改 `app/admin/(protected)/page.tsx` 追加 quickLinks**

- [ ] **Step 3: 修改 `app/page.tsx` 渲染 `<TargetsSection />`**（在现有看板内容之后插入）

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建成功，无类型错误。

- [ ] **Step 5: 提交**

```bash
git add "app/admin/(protected)/targets" "app/admin/(protected)/monitor-tasks" "app/admin/(protected)/alerts" "app/admin/(protected)/webhooks" "app/admin/(protected)/alert-events" "app/admin/(protected)/page.tsx" components/monitor app/page.tsx
git commit -m "feat(monitor): 后台管理页面与公开看板监控区块"
```

---

## Task 16: 全量验证 + 文档

**Files:**
- Modify: `CLAUDE.md`（在架构小节追加监控平台说明）
- Test: 全量 `pnpm test` + `pnpm build` + `pnpm lint`

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 passed（含现有测试，无回归）。

- [ ] **Step 2: 构建 + lint**

Run: `pnpm build && pnpm lint`
Expected: 构建成功，lint 无新增错误。

- [ ] **Step 3: 更新 CLAUDE.md**

在 `CLAUDE.md` 的「核心架构」之后追加一节，简述：监控平台目标（self/supplier）、采集器注册表、`monitor_tasks` 调度、`metric_samples` 宽表、告警引擎 + 飞书路由、新增 6 张表与对外 `/api/monitor/*`。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: 补充 newapi 监控平台架构说明"
```

---

## Self-Review（计划自检）

**1. Spec 覆盖**（对照 spec 各节）：
- §1.2 指标采集 → Task 8（usage/errors/balance/cache）+ Task 9（probe）✅
- §1.3 告警全类型 → Task 11 引擎 + Task 6 规则（error_count/reachable/ttft_ms/channel_balance 均可建规则）✅
- §2 newapi 访问机制 → Task 7 client 注入 `Authorization`+`New-Api-User` ✅
- §3 架构（采集器注册表 + next_run_at 调度）→ Task 7 分派器 + Task 4 调度 + Task 12 runner ✅
- §4 数据模型 6 表 → Task 1 schema ✅
- §5 采集器映射 + 降级 + 增量 → Task 8/9 + Task 7 SkipCollector ✅
- §6 告警状态机 + 飞书路由 + 加密 → Task 11 + Task 10 + Task 2 ✅
- §7 Admin UI + 公开看板 + 只读 API → Task 13/14/15 ✅
- §9 测试策略 → 每个后端 Task 均 TDD ✅
- §10 迁移（schema 幂等、复用 ADMIN_SESSION_SECRET、渐进上线）→ Task 1 + Task 2 + Task 12 ✅
- §12 待核实项 → 已在编码前核实并写入 Global Constraints（余额字段 `balance`、缓存为占用数改名 `cache_entries`、probe 默认 openai）✅

**2. Placeholder 扫描**：无 TBD/TODO；UI 层（Task 15）以骨架 + 明确字段清单给出（展示层无逻辑分支，骨架足够），其余全部含完整可运行代码。

**3. 类型一致性**：`SampleInput`（Task 5）被采集器（8/9）与 runner（12）一致使用；`runCollector`/`SkipCollector`（Task 7）被 runner（12）一致引用；`evaluateAlertRules` 返回 `{fired,resolved}`（Task 11）被 runner（12）一致消费；`MetricName`/`CollectorType` 联合类型贯穿一致；`cache_hit_rate` 已统一更正为 `cache_entries`（spec §12 核实结果）。

**已知偏差说明**：spec §1.2/§6 写的 `cache_hit_rate` 在源码核实后改为 `cache_entries`（newapi 仅暴露缓存占用条目数，无命中率）。实现以本计划为准。

---






