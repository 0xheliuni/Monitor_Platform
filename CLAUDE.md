<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Check CX 是一个基于 Next.js 的 AI 模型健康监控面板，用于实时监控 OpenAI、Gemini、Anthropic 等 AI 模型的 API 可用性、延迟和错误信息。项目采用分层架构，通过后台轮询持续采集健康结果，并提供可视化 Dashboard 与只读状态 API，适合团队内部状态墙、供应商 SLA 监控与多模型对比。数据层使用本地 SQLite（better-sqlite3），公开面板与管理后台合并为单个 Next.js 应用。

## 核心特性

- **统一 Provider 支持**：OpenAI、Gemini、Anthropic，支持 Chat Completions 与 Responses 端点
- **实时延迟监控**：首 token 延迟、Ping 延迟与历史时间线
- **分组管理**：支持分组视图与分组详情页，包含分组标签与官网链接
- **维护模式**：支持系统通知横幅（Markdown 格式，多条轮播）
- **官方状态集成**：自动轮询 OpenAI 与 Anthropic 官方状态
- **单进程架构**：轮询器为进程内单例，单 SQLite 文件，不支持横向扩展
- **管理后台**：`/admin/*` 路由，登录地址 `/admin/login`，由 `ADMIN_LOGIN_KEY` + HMAC session cookie 保护

## 常用命令

```bash
# 安装依赖
pnpm install

# 本地开发
pnpm dev

# 构建生产版本
pnpm build

# 运行生产服务器
pnpm start

# 代码检查
pnpm lint

# Docker 构建与运行
./deploy.sh                    # 构建并运行 Docker 容器
docker-compose up -d          # 使用 docker-compose 启动
```

## 环境配置

复制环境变量模板并配置：

```bash
cp .env.example .env.local
```

必需的环境变量：
- `SQLITE_DB_PATH` - SQLite 数据库文件路径（默认：`./data/monitor.db`）
- `ADMIN_LOGIN_KEY` - 管理后台登录密钥
- `ADMIN_SESSION_SECRET` - HMAC session cookie 签名密钥
- `APP_URL` - 应用公开 URL
- `CHECK_POLL_INTERVAL_SECONDS` - 检测间隔（15–600 秒，默认：60）
- `HISTORY_RETENTION_DAYS` - 历史记录保留天数
- `CHECK_CONCURRENCY` - 并发检查数（默认：5）
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` - 官方状态轮询间隔

## 核心架构

### 代码结构 (重构后)

项目采用分层架构,清晰的职责划分:

```
lib/
├── types/              # 统一类型定义
│   ├── index.ts       # 类型导出入口
│   ├── provider.ts    # Provider 相关类型
│   ├── check.ts       # 检查结果类型
│   ├── database.ts    # 数据库表类型
│   └── dashboard.ts   # Dashboard 数据类型
├── providers/          # Provider 检查逻辑
│   ├── index.ts       # 统一入口,批量执行检查
│   ├── openai.ts      # OpenAI 完整实现
│   ├── gemini.ts      # Gemini 完整实现
│   ├── anthropic.ts   # Anthropic 完整实现
│   └── stream-check.ts # 流式检查通用逻辑
├── db/                 # SQLite 数据层
│   ├── client.ts      # better-sqlite3 单例连接（WAL + foreign_keys + busy_timeout）
│   ├── schema.sql     # 权威 Schema（6 张表），migrate.ts 幂等执行
│   ├── migrate.ts     # 运行 schema.sql 的迁移入口
│   ├── history.ts     # 历史记录读写（window 函数替代 RPC）
│   ├── availability.ts # 可用性统计（operational+degraded 均计为可用）
│   ├── configs.ts     # check_configs CRUD + 应用层类型校验
│   ├── models.ts      # check_models CRUD + 应用层类型校验
│   ├── templates.ts   # check_request_templates CRUD
│   ├── groups.ts      # group_info CRUD
│   ├── notifications.ts # system_notifications CRUD
│   └── json.ts        # JSON 序列化/反序列化工具
├── database/           # 公开模块（供页面/API 调用）
│   ├── config-loader.ts # 配置加载，调用 lib/db/*
│   ├── history.ts     # 历史记录，调用 lib/db/history.ts
│   ├── availability.ts # 可用性，调用 lib/db/availability.ts
│   ├── group-info.ts  # 分组信息，调用 lib/db/groups.ts
│   └── notifications.ts # 系统通知，调用 lib/db/notifications.ts
├── admin/              # 管理后台模块
│   ├── queries.ts     # 管理查询，调用 lib/db/*
│   └── session.ts     # HMAC session cookie（node:crypto）
├── utils/              # 工具函数
│   ├── index.ts       # 工具函数统一导出
│   ├── cn.ts          # Tailwind className 合并
│   ├── url-helpers.ts # URL 处理工具
│   └── error-handler.ts # 统一错误处理
└── core/               # 核心模块
    ├── global-state.ts # 全局状态管理
    ├── poller.ts      # 后台轮询器（进程内单例，timer handle 防重复）
    ├── dashboard-data.ts # Dashboard 数据聚合
    ├── status.ts      # 状态元数据
    └── polling-config.ts # 轮询配置
```

### 后台轮询系统

项目核心是一个服务器端轮询系统，在应用启动时自动初始化并持续运行:

- **入口**: `lib/core/poller.ts` 通过 `instrumentation.ts` 在 `runMigrations()` 完成后自动启动，模块导入即自启
- **单进程单例**: 以 timer handle 作为守卫，防止 Next.js 热重载时重复创建定时器；**不支持横向扩展**（单进程、单 SQLite 文件）
- **触发**: 使用 `setInterval` 按 `CHECK_POLL_INTERVAL_SECONDS` 间隔执行检测（默认 60 秒，支持 15-600 秒）
- **全局状态**: 通过 `lib/core/global-state.ts` 统一管理轮询定时器和运行状态
- **并发控制**: 使用标志位防止多个检测任务重叠执行
- **官方状态轮询**: `lib/core/official-status-poller.ts` 定时抓取 OpenAI 和 Anthropic 官方状态

### 配置管理

配置通过 SQLite 数据库的 `check_models` / `check_configs` / `check_request_templates` 三层结构管理（使用 sqlite3 CLI 或任意 SQLite 客户端操作）：

- **配置加载**: `lib/database/config-loader.ts:loadProviderConfigsFromDB()` 从 `lib/db/*` 读取已启用的配置，并关联模型与模板
- **动态启用/禁用**: 通过更新数据库 `enabled` 字段即可控制检测任务，无需重启应用
- **维护模式**: 设置 `is_maintenance = true` 保留卡片但停止轮询，显示维护状态
- **分组管理**: 通过 `group_name` 字段对配置进行分组，支持分组视图和详情页
- **模型复用**: 通过 `check_models` 统一维护模型名与模板绑定，`check_configs` 使用 `model_id` 关联
- **默认请求参数**: `request_header` 和 `metadata` 只保存在 `check_request_templates`
- **链路关系**: `check_configs` → `check_models` → `check_request_templates`
- **类型校验**: `lib/db/models.ts` 和 `lib/db/configs.ts` 在应用层做类型校验，不匹配时抛出"模板类型不匹配"/"模型类型不匹配"
- **类型安全**: 使用 `lib/types/database.ts` 中定义的 `CheckConfigRow` 类型

### 健康检查流程

1. **配置加载**: `lib/database/config-loader.ts:loadProviderConfigsFromDB()` 读取所有启用的配置
2. **数学挑战验证**: `lib/providers/challenge.ts` 生成数学题验证模型响应能力
3. **Provider 检查**: `lib/providers/ai-sdk-check.ts` 使用 Vercel AI SDK 并发执行所有配置的检查
4. **延迟测量**: 测量首 token 延迟和端点 Ping 延迟
5. **状态判定**:
   - `operational`: 请求成功且延迟 ≤ 6000ms
   - `degraded`: 请求成功但延迟 > 6000ms
   - `failed`: 请求失败或超时（默认超时 15 秒）
   - `maintenance`: 配置标记为维护模式
6. **三类 Provider 支持**:
   - **OpenAI**: 支持 Chat Completions 和 Responses API
   - **Gemini**: Google AI 模型支持
   - **Anthropic**: Claude 系列模型支持

### 数据存储与历史

- **历史写入**: `lib/db/history.ts:appendHistory()` 将检测结果写入 SQLite `check_history` 表
- **数据清理**: 使用 SQL window 函数 + DELETE 自动清理，每个配置按 `HISTORY_RETENTION_DAYS` 保留历史记录
- **可用性统计**: `lib/db/availability.ts` 计算 7/15/30 天可用性（`operational` 和 `degraded` 均计为可用）
- **快照服务**: `lib/core/health-snapshot-service.ts` 统一读取历史与触发刷新
- **数据结构**: 使用 `config_id` 外键关联 `check_configs` 表，存储 `status`、`latency_ms`、`checked_at`、`message` 字段
- **类型安全**: 使用 `lib/types/database.ts` 中定义的 `CheckHistoryRow` 类型

### Dashboard 数据流

1. **页面渲染**: `app/page.tsx` 使用 `loadDashboardData({ refreshMode: "missing" })` 加载初始数据
2. **API 路由**:
   - `app/api/dashboard/route.ts` - Dashboard 数据 API（ETag + CDN 缓存）
   - `app/api/group/[groupName]/route.ts` - 分组数据 API
   - `app/api/v1/status/route.ts` - 对外只读状态 API
3. **刷新模式**:
   - `missing`: 仅当数据库中无历史记录时触发一次实时检测
   - `always`: 强制触发实时检测（用于 `/api/dashboard` 路由）
   - `never`: 仅从数据库读取历史记录
4. **缓存机制**:
   - 后端：`lib/core/health-snapshot-service.ts` 使用全局缓存，避免在轮询间隔内重复检测
   - 前端：`lib/utils/frontend-cache.ts` 实现 SWR 风格缓存，配合 ETag
5. **前端轮询**: `components/dashboard-view.tsx` 使用客户端定时器定期调用 `/api/dashboard` 获取最新数据
6. **数据聚合**: `lib/core/dashboard-data.ts` 和 `lib/core/group-data.ts` 负责分组与统计数据

### SQLite 数据层

- **连接单例**: `lib/db/client.ts` 提供 better-sqlite3 单例连接，启用 WAL 模式、foreign_keys 和 busy_timeout
- **权威 Schema**: `lib/db/schema.sql` 定义全部 6 张表，`lib/db/migrate.ts` 在应用启动时幂等执行
- **公开模块**: `lib/database/*`（config-loader、history、availability、group-info、notifications）均调用 `lib/db/*`
- **管理模块**: `lib/admin/queries.ts` 和 `app/admin/**/actions.ts` 也调用 `lib/db/*`
- **数据目录**: `data/` 目录存放 `monitor.db` 及 WAL 文件，通过 Docker volume 持久化
- **环境变量**:
  - `SQLITE_DB_PATH`: SQLite 文件路径（默认 `./data/monitor.db`）
  - `ADMIN_LOGIN_KEY`: 管理后台登录密钥
  - `ADMIN_SESSION_SECRET`: HMAC session cookie 签名密钥

### 数据库表结构

完整 Schema 见 `lib/db/schema.sql`（权威来源）。以下为各表结构概要：

```sql
-- 请求模板表
check_request_templates (
  id TEXT PRIMARY KEY,           -- app 生成的 crypto.randomUUID()
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,            -- 'openai' | 'gemini' | 'anthropic'
  request_header TEXT,           -- JSON 字符串
  metadata TEXT,                 -- JSON 字符串
  created_at TEXT NOT NULL,      -- ISO8601 文本
  updated_at TEXT NOT NULL
)

-- 模型表
check_models (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'openai' | 'gemini' | 'anthropic'
  model TEXT NOT NULL,
  template_id TEXT REFERENCES check_request_templates(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

-- 配置表
check_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES check_models(id),
  endpoint TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,       -- SQLite 布尔：1/0
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  group_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

-- 历史记录表
check_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,     -- 整型自增主键
  config_id TEXT REFERENCES check_configs(id),
  status TEXT NOT NULL,          -- 'operational' | 'degraded' | 'failed' | 'maintenance'
  latency_ms INTEGER,
  ping_latency_ms INTEGER,
  checked_at TEXT NOT NULL,      -- ISO8601 文本
  message TEXT
)

-- 分组信息表
group_info (
  group_name TEXT PRIMARY KEY,
  display_name TEXT,
  description TEXT,
  website_url TEXT,
  icon_url TEXT
)

-- 系统通知表
system_notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,         -- Markdown 格式
  level TEXT DEFAULT 'info',     -- 'info' | 'warning' | 'error'
  start_time TEXT,               -- ISO8601 文本
  end_time TEXT,
  created_at TEXT NOT NULL
)
```

### 数据层说明

- **可用性计算**: `lib/db/availability.ts` 将 `operational` 和 `degraded` 均计为可用
- **历史清理**: `lib/db/history.ts` 使用 SQL window 函数定位超出保留条数的记录后 DELETE，替代原 Postgres RPC
- **类型校验**: 写入 `check_models` / `check_configs` 时应用层校验类型一致性，不匹配抛出异常

## newapi 监控平台

在原有 AI 模型健康监控之上，本项目内置一套 newapi 实例监控平台，用于监控自有及供应商的 newapi 网关：使用信息、模型用量、各渠道 TTFT / 连通性、缓存占用、渠道报错，并支持阈值告警 + 飞书机器人提醒。该子系统与原健康检查轮询器并行运行，复用同一 SQLite 库与单进程轮询架构。

### 监控目标（targets）

- **两类目标**：`self`（自有 newapi，持有 admin token，可拉取全量管理数据）与 `supplier`（供应商实例，仅做主动探测）。
- **访问机制**：`lib/collectors/newapi-client.ts:newapiGet()` 注入 `Authorization: <admin_token>` 与 `New-Api-User: <admin_user_id>` 头，解析 newapi 的 `{success, data}` 信封，15 秒超时。
- **敏感字段加密**：`admin_token` / `probe_api_key` 经 `lib/db/monitor-crypto.ts`（AES-256-GCM，密钥由 `ADMIN_SESSION_SECRET` 经 HKDF-SHA256 派生）加密入库，读出时解密；对外 API 与列表页只暴露 `maskSecret()` 脱敏值，绝不返回明文。

### 采集器（collectors）

`lib/collectors/index.ts` 维护采集器注册表（`collector_type → collect 函数`），`runCollector(target, task)` 分派；当 `collector_type !== "active_probe"` 且 `target.kind === "supplier"` 时抛 `SkipCollector`（供应商无管理权限，仅允许主动探测）。

- **拉取型**（self 专用）：`newapi-usage`（`/api/data`，增量时间窗，产出 usage_quota/usage_tokens/request_count，带 model/user 维度）、`newapi-errors`（`/api/log?type=5`，按渠道聚合 error_count）、`newapi-balance`（`/api/channel/`，渠道余额）、`newapi-cache`（`/api/option/channel_affinity_cache`，缓存占用条目数 cache_entries）。
- **主动探测型**（self + supplier）：`active-probe` 复用 `lib/providers/ai-sdk-check.ts` 测量 reachable / ttft_ms / ping_ms。

### 调度与运行

- **任务调度**：`monitor_tasks` 表以 `next_run_at` 时间戳驱动；`getDueTasks(now)` 取出到期且 `enabled=1 AND is_maintenance=0` 的任务，`recordTaskRun()` 在每次执行后推迟 `next_run_at = now + interval_seconds`（无论成功/跳过/失败都重排，避免紧密重试）。
- **运行器**：`lib/core/monitor-runner.ts:runMonitorOnce()` 为一个采集周期——取到期任务 → `p-limit` 并发执行采集器 → `insertSamples()` → 重排 → `evaluateAlertRules()` → 按需 `cleanupSamples()`。已接入既有后台轮询器 `lib/core/poller.ts` 的 `tick()`（独立 try/catch，监控失败不影响原健康检查）。

### 指标存储与告警

- **宽表**：`metric_samples` 时序宽表，含 `metric` / `value` / `dim_model` / `dim_user` / `dim_channel` / `checked_at` / `meta`，`lib/db/samples.ts` 提供批量写入、窗口聚合（sum/avg/max/min/count/last，空窗 sum/avg/max/min→null、count→0）、最新 N 条、区间序列与保留期清理。
- **告警引擎**：`lib/alerting/engine.ts:evaluateAlertRules()` 按规则在时间窗内聚合指标并与阈值比较，运行 firing/resolved 状态机，含去抖（连续 `consecutive_breaches` 次才触发）与去重（已 firing 不重复发送）；每条 `alert_rules` 对应一行 `alert_events` 状态。
- **飞书通知**：`lib/alerting/feishu-card.ts` 构建交互式卡片（resolved 绿、severity 决定 info 蓝/warning 橙/critical 红），按飞书规范签名（`timestamp\nsecret` 作 HMAC-SHA256 密钥、空消息体）并发送（失败重试一次）。`lib/db/feishu.ts:resolveWebhook()` 路由优先级：显式 webhookId → 按 group_name 匹配 → group_name 为 NULL 的默认 webhook → 无。

### 数据模型（新增 6 张表）

`monitor_targets`、`monitor_tasks`、`metric_samples`、`alert_rules`、`alert_events`、`feishu_webhooks`，权威定义见 `lib/db/schema.sql`，由 `lib/db/migrate.ts` 幂等迁移（与原 6 张表同库）。

### 管理与对外接口

- **后台管理**：`/admin/targets`、`/admin/monitor-tasks`、`/admin/alerts`、`/admin/webhooks`、`/admin/alert-events` 页面，配套 `app/admin/(protected)/*/actions.ts` Server Actions；全部经 `requireAppUser()` + `isAdminUser` 管理员守卫。
- **对外只读 API**：`/api/monitor/targets`（概览）、`/api/monitor/targets/[id]`（详情）、`/api/monitor/metrics`（区间序列），均 `force-dynamic`，仅返回脱敏字段，绝不含明文密钥。
- **公开看板区块**：`components/monitor/targets-section.tsx` 客户端轮询 `/api/monitor/targets`，渲染可用性 / TTFT / 报错卡片网格。

## 关键约定

### 数据流向

- **后台 → 数据库**: `lib/core/poller.ts` → `lib/providers/` → `lib/db/history.ts` → SQLite
- **数据库 → 前端**: SQLite → `lib/db/*` → `lib/core/dashboard-data.ts` → `app/page.tsx` → `components/dashboard-view.tsx`
- **实时刷新**: 前端定时器 → `/api/dashboard` → `lib/core/dashboard-data.ts`

### 类型系统

- **统一导出**: 所有类型从 `lib/types/index.ts` 统一导出
- **分类清晰**: 类型按职责分为 provider、check、database、dashboard 四类
- **类型安全**: 数据库查询使用明确的类型定义,避免类型断言

### 模块职责

- **单一职责**: 每个模块专注单一功能,文件不超过 200 行
- **清晰边界**: providers 负责检查,database 负责存储,core 负责协调
- **易于扩展**: 新增 Provider 只需在 `lib/providers/` 添加一个文件

### 性能优化

1. **流式响应**: 使用 Vercel AI SDK 的流式 API，只需接收到首个 token 即可判定可用性
2. **Token 限制**: 所有请求设置 `max_tokens: 1`，最小化响应数据量
3. **数学挑战**: 使用简单的数学题验证模型响应，避免复杂 prompt 的开销
4. **缓存策略**:
   - 后端快照缓存：基于轮询间隔的全局缓存，避免重复检测
   - 前端 SWR 缓存：配合 ETag 实现高效的客户端缓存
   - 官方状态缓存：内存 Map 缓存官方状态结果
5. **并发控制**: 使用 `p-limit` 控制最大并发数（默认 5，可配置）
6. **数据清理**: 自动清理历史记录，每个配置最多保留 60 条
7. **数据库优化**: 启用 WAL 模式提升并发读性能；历史清理使用 window 函数批量 DELETE

### 错误处理

- 所有网络请求都有 15 秒超时控制
- 检测失败时返回 `status: "failed"`,不抛出异常
- 数据库操作失败时记录日志并返回空数据/上次缓存
- 轮询器使用 `try-catch` 包裹,单次失败不影响后续执行
- **统一日志**: 使用 `lib/utils/error-handler.ts` 的 `logError()` 记录错误

## 添加新的 AI Provider

1. 在 `lib/types/provider.ts` 中添加 `ProviderType` 类型
2. 在 `lib/providers/` 创建新文件,实现 `checkXxx()` 函数
3. 使用 `runStreamCheck()` 提供的通用流式检查逻辑
4. 实现 Provider 特定的流解析器 (`parseXxxStream()`)
5. 在 `lib/providers/index.ts` 的 `checkProvider()` switch 中添加分支
6. 在 `lib/core/status.ts` 的 `PROVIDER_LABEL` 中添加显示名称
7. 在 `components/provider-icon.tsx` 中添加对应图标

**示例**:

```typescript
// lib/providers/新provider.ts
import type { CheckResult, ProviderConfig } from "../types";
import { ensurePath } from "../utils";
import { runStreamCheck } from "./stream-check";

async function parse新ProviderStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  // 实现流解析逻辑
}

export async function check新Provider(
  config: ProviderConfig
): Promise<CheckResult> {
  const url = ensurePath(config.endpoint, "/api/endpoint");
  const payload = { /* ... */ };

  return runStreamCheck(config, {
    url,
    displayEndpoint: config.endpoint,
    init: {
      headers: { /* ... */ },
      body: JSON.stringify(payload),
    },
    parseStream: parse新ProviderStream,
  });
}
```

## 修改配置

不要通过环境变量管理 CHECK 配置，请使用 SQLite CLI（`sqlite3 data/monitor.db`）或任意 SQLite 客户端操作数据库。

注意：SQLite 不支持 `gen_random_uuid()` 和 `now()`，`id` 和时间戳字段由应用层生成（`crypto.randomUUID()` + ISO8601 文本）。手动 INSERT 时需自行提供这些值。

```sql
-- 先创建或复用模板
INSERT INTO check_request_templates (id, name, type, request_header, metadata, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))),  -- 或直接填写 uuid 字符串
  'openai-default',
  'openai',
  '{"User-Agent": "check-cx"}',
  '{"temperature": 0}',
  datetime('now'),
  datetime('now')
)
ON CONFLICT (name) DO NOTHING;

-- 再创建或复用模型，并把模板绑到模型上
INSERT INTO check_models (id, type, model, template_id, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'openai', 'gpt-4o-mini', id, datetime('now'), datetime('now')
FROM check_request_templates
WHERE name = 'openai-default'
ON CONFLICT (type, model) DO NOTHING;

-- 添加配置
INSERT INTO check_configs (id, name, type, model_id, endpoint, api_key, enabled, created_at, updated_at)
SELECT lower(hex(randomblob(16))), '主力 OpenAI', 'openai', id,
       'https://api.openai.com/v1/chat/completions',
       'sk-xxx', 1, datetime('now'), datetime('now')
FROM check_models
WHERE type = 'openai' AND model = 'gpt-4o-mini';

-- 更新模型绑定的模板
UPDATE check_models
SET template_id = (
  SELECT id
  FROM check_request_templates
  WHERE name = 'openai-default'
),
updated_at = datetime('now')
WHERE type = 'openai'
  AND model = 'gpt-4o-mini';

-- 禁用配置
UPDATE check_configs SET enabled = 0, updated_at = datetime('now') WHERE name = '主力 OpenAI';

-- 删除配置
DELETE FROM check_configs WHERE name = '旧配置';

-- 设置维护模式
UPDATE check_configs SET is_maintenance = 1, updated_at = datetime('now') WHERE name = '维护中的服务';

-- 设置分组
UPDATE check_configs SET group_name = '生产环境', updated_at = datetime('now') WHERE name IN ('OpenAI GPT-4', 'Claude 3');

-- 添加分组信息
INSERT INTO group_info (group_name, display_name, description, website_url)
VALUES ('生产环境', 'Production', '核心生产环境模型', 'https://status.openai.com');

-- 添加系统通知
INSERT INTO system_notifications (id, message, level, start_time, end_time, created_at)
VALUES (
  lower(hex(randomblob(16))),
  '**系统维护通知**：今晚 22:00-24:00 进行系统维护，可能影响服务可用性。',
  'warning',
  datetime('now'),
  datetime('now', '+2 days'),
  datetime('now')
);
```

## 调试轮询器

轮询器在每次执行时会输出详细日志:

- 检测开始/结束时间
- 每个配置的检测结果、延迟、状态
- 历史记录写入结果
- 下次预计执行时间

查看服务器日志:

```bash
pnpm dev  # 在开发模式下日志会输出到终端
```

## 测试指南

目前项目尚未集成自动化测试框架，但建议：

1. **手动测试**：运行 `pnpm dev`，验证 Dashboard 刷新和数据显示
2. **数据库测试**：使用 `sqlite3 data/monitor.db` 检查数据完整性，确认 `runMigrations()` 幂等执行
3. **Provider 测试**：使用 mock 端点测试不同 Provider 的适配性
4. **性能测试**：验证多配置并发检查的性能表现

## 开发约定

### 代码风格
- 默认使用 Server Components，仅在需要时添加 `"use client"`
- TypeScript 文件使用 2 空格缩进，优先使用 `const`
- 组件命名使用 PascalCase，如 `DashboardView`
- 导入排序：Node 内置模块 → 第三方包 → `@/` 别名路径

### 提交规范
遵循 Conventional Commits：
- `feat:` - 新功能
- `fix:` - Bug 修复
- `chore:` - 构建或工具变更
- `refactor:` - 代码重构
- `docs:` - 文档更新

### 安全提醒
- 不要提交真实的 API 密钥到版本控制
- 使用环境变量或数据库存储敏感配置
- 在分享日志前清理敏感信息

## 扩展文档

更多详细信息请参考项目文档：
- `docs/ARCHITECTURE.md` - 架构设计说明
- `docs/OPERATIONS.md` - 运维手册
- `docs/EXTENDING_PROVIDERS.md` - Provider 扩展指南
- `AGENTS.md` - 项目规范和约定
