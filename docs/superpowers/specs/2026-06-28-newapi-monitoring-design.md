# newapi 监控平台设计文档

- **日期**：2026-06-28
- **作者**：AI 生成（Claude Code 辅助）
- **状态**：设计待评审
- **基础项目**：Check CX（Next.js + SQLite + 进程内轮询器），位于 `E:\Prod_Project\other\Monitor_Platform`

---

## 1. 背景与目标

在现有 Check CX 健康监控面板基础上扩展，构建一个监控多个 newapi 实例的平台。监控对象分两类：

- **自有实例（self）**：拥有管理员/Root access token，可拉取聚合数据（用户用量、模型用量、错误日志、渠道余额、缓存统计），并可主动实测。
- **供应商实例（supplier）**：仅有一把普通 `sk-` API key，只能主动实测（TTFT、连通性、模型可用性）。

### 1.1 监控范围（已确认）

实时健康墙 + 告警为主。**拉取聚合值**而非搬运原始日志，时序快照存入 SQLite，用于趋势图与阈值告警。**不导入** newapi 的原始 consume 日志。

### 1.2 需采集的指标

| 指标 | 来源 | 适用 |
|---|---|---|
| 用户使用汇总（quota/tokens/请求数） | `GET /api/data`（自有，admin token） | self |
| 模型使用汇总 | `GET /api/data`（同上，含 model_name 维度） | self |
| 渠道报错（错误数/错误样本） | `GET /api/log?type=5`（自有） | self |
| 渠道余额 | `GET /api/channel/`（自有） | self |
| 缓存统计 | `GET /api/option/channel_affinity_cache`（自有，需 root） | self(root) |
| TTFT / Ping / 连通性 | 主动实测（`sk-` key 发流式请求） | self & supplier |

### 1.3 告警范围（已确认全选）

- 渠道报错预警（type=5 错误日志聚合超阈值）
- 连通性/可用性下降
- TTFT/延迟过高
- 渠道余额不足

飞书机器人告警，**按实例/分组路由到不同 webhook**，支持 info/warning/critical 分级。

---

## 2. newapi 访问机制（核实自源码）

new-api 管理类接口（`middleware.AdminAuth()`，见 `new-api/middleware/auth.go:authHelper`）支持两种鉴权：

1. **Session Cookie**（网页登录）
2. **Access Token**：HTTP 头
   ```
   Authorization: <access_token>
   New-Api-User: <用户ID>
   ```
   即用户的「系统令牌」，配合 `New-Api-User` 头可调用全部 admin 接口。

权限分级：`/api/log`、`/api/data`、`/api/channel/*` 为 **AdminAuth**；缓存统计 `/api/option/channel_affinity_cache` 为 **RootAuth**。

核实过的数据结构：
- `Log`（`new-api/model/log.go`）：`model_name`、`quota`、`prompt_tokens`、`completion_tokens`、`use_time`、`channel`、`type`（type=5 为错误日志）。
- `QuotaData`（`new-api/model/usedata.go`）：`/api/data` 返回，按 (model_name, username, day) 聚合，含 `token_used`、`count`、`quota`。
- `/api/log/stat`：返回 `quota`/`rpm`/`tpm` 聚合值。

---

## 3. 整体架构

复用现有 Check CX 单进程架构，把 newapi 采集做成现有轮询器的第二类被轮询对象。

```
                     ┌─────────────────── Check CX (Next.js, 单进程) ───────────────────┐
                     │                                                                  │
 自有 newapi ─admin token─┐                                                             │
 (拉聚合)                  │   ┌──────────────┐  monitor_tasks 表(next_run_at 驱动)      │
 供应商 newapi ─sk- key─┐  │   │   Poller     │─┬─► newapi_* 采集器(拉聚合) ─┐          │
 (主动实测)             │  └──►│ (现有单例,    │ └─► active_probe 采集器(实测)┤          │
                        └────►│  扩展调度)    │                            ▼          │
                              └──────────────┘                  写入 metric_samples    │
                                     │                                  │               │
                                     ▼                                  ▼               │
                                告警引擎(评估 alert_rules) ─► Feishu 路由器 ─► 飞书群      │
                                                                        │               │
              Dashboard / Admin ◄── 读 metric_samples + monitor_targets ─────────────────┘
```

**数据流**：
- **采集**：poller 每 tick 扫 `monitor_tasks`，挑出 `next_run_at <= now` 的任务，按 `collector_type` 分派；结果写入统一 `metric_samples` 时序表，并更新 `next_run_at = now + interval_seconds`。
- **告警**：采集后告警引擎按 `alert_rules` 评估最近窗口的 `metric_samples`，状态跳变时经 Feishu 路由器推送。
- **展示**：Dashboard/Admin 读 `metric_samples` 聚合 + 目标元数据，复用现有 SWR+ETag 缓存。

**复用现有基础设施**：poller 单例守卫（timer handle）、`p-limit` 并发控制、错误隔离（try-catch 包裹）、`lib/db/client.ts` SQLite 单例、`lib/admin/session.ts` HMAC session、`lib/utils/frontend-cache.ts` 前端缓存、`lib/providers/*` 实测逻辑。

**架构决策**：采用「复用现有轮询器 + 采集器注册表」方案（而非独立双轮询器或外部 cron）。理由：与现有架构同构、最大化复用、契合 CLAUDE.md「进程内单例、不支持横向扩展」的设计哲学。唯一新增核心机制是**按任务独立调度**（`next_run_at` 驱动，而非全局固定 interval），以支持不同任务的不同周期（如拉聚合每 5 分钟、实测每 60 秒）。

---

## 4. 数据模型（SQLite 新增表）

沿用现有 `lib/db/schema.sql` 风格：TEXT 主键 = `crypto.randomUUID()`，ISO8601 时间文本，布尔用 1/0，id 与时间戳由应用层生成。新增 6 张表。

```sql
-- ① 监控目标：一个 newapi 实例（自有或供应商）
monitor_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                  -- 显示名，如「生产 newapi-A」
  base_url TEXT NOT NULL,              -- https://api.xxx.com
  kind TEXT NOT NULL,                  -- 'self' | 'supplier'
  admin_token TEXT,                    -- access token (Authorization)，加密存储；供应商留空
  admin_user_id TEXT,                  -- New-Api-User 头的值
  probe_api_key TEXT,                  -- sk- key（加密存储），实测用
  group_name TEXT,                     -- 分组（告警路由 + 视图）
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

-- ② 监控任务：统一抽象 = 目标 + 采集类型 + 周期 + 调度状态
monitor_tasks (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES monitor_targets(id),
  name TEXT NOT NULL,
  collector_type TEXT NOT NULL,        -- 'newapi_usage'|'newapi_errors'|'newapi_balance'
                                       -- |'newapi_cache'|'active_probe'
  config TEXT,                         -- JSON：采集器参数（probe 的 model/format、
                                       -- pull 时间窗、channel_id 列表等）
  interval_seconds INTEGER NOT NULL,   -- 该任务独立周期
  enabled INTEGER NOT NULL DEFAULT 1,
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,                    -- 调度核心：<= now 才执行
  last_run_at TEXT,
  last_status TEXT,                    -- 'ok'|'failed'|'skipped'
  last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

-- ③ 时序样本：所有采集结果的统一落点（宽表 + 维度键）
metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES monitor_tasks(id),
  target_id TEXT NOT NULL,             -- 冗余，便于按目标查询
  metric TEXT NOT NULL,                -- 'ttft_ms'|'ping_ms'|'reachable'
                                       -- |'usage_quota'|'usage_tokens'|'request_count'
                                       -- |'error_count'|'channel_balance'|'cache_hit_rate'
  dim_model TEXT,                      -- 维度：模型名（可空）
  dim_user TEXT,                       -- 维度：用户名（可空）
  dim_channel TEXT,                    -- 维度：渠道 id/名（可空）
  value REAL NOT NULL,
  checked_at TEXT NOT NULL,            -- ISO8601
  meta TEXT                            -- JSON：附加信息（错误样本摘要等）
)
-- 索引：(target_id, metric, checked_at)、(task_id, checked_at)

-- ④ 告警规则
alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_id TEXT REFERENCES monitor_targets(id),  -- 可空=全局
  task_id TEXT REFERENCES monitor_tasks(id),      -- 可空
  metric TEXT NOT NULL,
  comparator TEXT NOT NULL,            -- '>'|'<'|'>='|'<='|'=='
  threshold REAL NOT NULL,
  window_seconds INTEGER NOT NULL,     -- 评估窗口
  aggregation TEXT NOT NULL,           -- 'sum'|'avg'|'max'|'min'|'count'|'last'
  consecutive_breaches INTEGER DEFAULT 1, -- 连续 N 次才触发（防抖）
  severity TEXT NOT NULL DEFAULT 'warning', -- 'info'|'warning'|'critical'
  feishu_webhook_id TEXT REFERENCES feishu_webhooks(id), -- 路由（可空=按 group 默认）
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

-- ⑤ 飞书 webhook
feishu_webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  secret TEXT,                         -- 飞书签名密钥（可空）
  group_name TEXT,                     -- 默认服务的分组（路由用）
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

-- ⑥ 告警事件状态机（去重/恢复通知）
alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id),
  state TEXT NOT NULL,                 -- 'firing'|'resolved'
  breach_count INTEGER DEFAULT 0,
  first_seen_at TEXT, last_seen_at TEXT, resolved_at TEXT,
  last_notified_at TEXT,               -- 静默窗口控制
  message TEXT
)
```

**设计要点**：
- `metric_samples` 用**宽表 + 维度键**而非每指标一张表 → 加新指标无需改 schema，告警引擎统一查询。
- 维度固定 model/user/channel 三个（已确认够用）。
- 清理沿用现有 `HISTORY_RETENTION_DAYS` 思路，按 `(target_id, metric)` 分组保留。
- `admin_token`/`probe_api_key` 为敏感字段 → 写入前用 `ADMIN_SESSION_SECRET` 经 HKDF 派生密钥做 AES-256-GCM 对称加密存储（详见 §6）。

---

## 5. 采集器与 newapi 接口映射

5 个采集器，每个是 `lib/collectors/` 下一个文件，统一实现 `Collector` 接口：
```ts
interface Collector {
  run(target: MonitorTarget, task: MonitorTask): Promise<MetricSample[]>;
}
```
分派器（`lib/collectors/index.ts`）根据 `collector_type` 调用对应采集器。

自有实例拉取头（核实自 `middleware/auth.go`）：
```
Authorization: <admin_token>
New-Api-User: <admin_user_id>
```

| 采集器 | newapi 接口 | 产出 metric_samples | 适用 |
|---|---|---|---|
| `newapi_usage` | `GET /api/data?start_timestamp=&end_timestamp=` → `QuotaData[]` | 每 (model,user)：`usage_quota`/`usage_tokens`/`request_count`（dim_model/dim_user） | self |
| `newapi_errors` | `GET /api/log?type=5&start_timestamp=&end_timestamp=&p=&page_size=` | `error_count`（按 channel 聚合，dim_channel），meta 存错误摘要 | self |
| `newapi_balance` | `GET /api/channel/`（含余额字段）；可选触发 `GET /api/channel/update_balance/:id` | `channel_balance`（dim_channel） | self |
| `newapi_cache` | `GET /api/option/channel_affinity_cache`（需 root） | `cache_hit_rate` 等 | self(root) |
| `active_probe` | 不调管理接口，用 `probe_api_key` 向 `base_url` 发流式请求，复用 `lib/providers/` 首 token 计时 + 数学挑战 | `ttft_ms`/`ping_ms`/`reachable`（dim_model） | self & supplier |

**关键设计决策**：
1. **拉取增量**：`newapi_usage`/`newapi_errors` 每次只拉 `[last_run_at, now]` 时间窗，避免重复计数；首次跑拉最近一个窗口。
2. **采集器降级**：`newapi_cache` 需 root；若 target 仅 admin 非 root，该任务标 `last_status='skipped'`，UI 提示「需要 root token」。供应商目标（kind='supplier'）创建任务时 UI 只允许选 `active_probe`。
3. **实测复用**：`active_probe` 复用现有 provider check（按 `config.format` 选 openai/gemini/anthropic）；newapi 对外为 OpenAI 兼容 `/v1/chat/completions`，默认 openai 格式。
4. **错误隔离**：单采集器抛错 → 该任务 `last_status='failed'` 记 `last_error`，不影响其他任务（沿用现有 try-catch）。
5. **待实现期核实**：`/api/channel/` 返回的余额字段名在编码前以源码核实（`controller/channel.go` / `model/channel.go`）。

---

## 6. 告警引擎与飞书路由

**评估时机**：poller 每 tick 采集后，遍历 `enabled` 的 `alert_rules`，逐条：
1. 查 `metric_samples`：`target/task/metric` 匹配 AND `checked_at >= now - window_seconds`。
2. 按 `aggregation` 聚合（sum/avg/max/min/count/last）→ `currentValue`。
3. `comparator threshold` 比较 → breached?
4. 取该规则 `alert_events` 当前状态，跑状态机。

**状态机（去重 + 防抖 + 恢复）**：
- `正常 → 累积中`：breached 时 `breach_count++`。
- `累积中 → firing`：`breach_count >= consecutive_breaches`，发飞书（firing）。
- `firing → resolved`：not breached，发飞书（✅ 已恢复），`resolved_at` 记录。
- **去重**：仅在 `正常→firing` 跳变发首次告警，firing 期间不重复。
- **静默窗口**：`last_notified_at` 控制。**默认行为：只发一次 firing + 一次 resolved**（已确认，不在 firing 期间重发刷屏）。

**飞书路由器**（`lib/alerting/feishu.ts`）选 webhook 优先级：
1. `rule.feishu_webhook_id`（显式指定）
2. 按 `target.group_name` 匹配 `feishu_webhooks.group_name`
3. 默认 webhook（`group_name` 为空那条）

- 消息用飞书**交互式卡片**，severity 决定颜色（info蓝/warning橙/critical红），含目标名、规则名、当前值/阈值、时间窗、首次发生时间、回平台下钻链接。
- 飞书签名：webhook 配 `secret` 时按飞书规范 `timestamp+secret` 做 HMAC-SHA256。
- 发送失败重试 1 次，仍失败记 `logError`，不阻塞 poller。

**敏感字段加密**：`admin_token`/`probe_api_key` 用 `node:crypto` AES-256-GCM，密钥由 `ADMIN_SESSION_SECRET` 经 HKDF 派生；读取时解密，日志/接口响应永不返回明文（脱敏为 `sk-****1234`）。

---

## 7. 后台管理 UI 与对外接口

复用现有 `/admin/*` 路由（HMAC session 保护）与 Server Actions 模式（`app/admin/**/actions.ts` 调 `lib/db/*`）。

**新增 Admin 页面**：

| 路由 | 功能 |
|---|---|
| `/admin/targets` | 监控目标 CRUD：增删改 newapi 实例，填 token/key（脱敏显示），测试连通性按钮 |
| `/admin/tasks` | 监控任务 CRUD：选目标 + 采集类型 + 周期 + 维护开关；供应商目标仅显示 `active_probe`；显示 last_status/last_run_at/last_error |
| `/admin/alerts` | 告警规则 CRUD：选 target/task/metric + 比较器/阈值/窗口/聚合/连续次数/严重级别 + 绑定 webhook |
| `/admin/webhooks` | 飞书 webhook CRUD：url/secret/分组；「发送测试消息」按钮 |
| `/admin/alert-events` | 告警事件历史：firing/resolved 时间线，便于复盘 |

**新增公开 Dashboard**（复用现有看板组件风格）：

| 路由 | 功能 |
|---|---|
| `/`（扩展现有看板） | 增加「newapi 监控」区：按目标/分组展示卡片（可用性、TTFT、错误数、余额状态灯） |
| `/targets/[id]` | 单目标详情：TTFT/错误数/用量趋势图，模型用量 TOP、用户用量 TOP、渠道余额表、缓存命中 |

**新增对外只读 API**（沿用现有 ETag + CDN 缓存）：
```
GET /api/monitor/targets            → 目标列表 + 最新状态
GET /api/monitor/targets/[id]       → 单目标聚合指标
GET /api/monitor/metrics?target=&metric=&from=&to=  → 时序数据（画图）
GET /api/v1/monitor/status          → 对外状态总览（类似现有 /api/v1/status）
```

**前端刷新**：复用 `components/dashboard-view.tsx` 客户端定时器 + SWR 缓存模式，定期拉 `/api/monitor/*`。

---

## 8. 代码组织（新增模块）

沿用现有分层与「单文件单职责、不超过 200 行」约定：

```
lib/
├── types/
│   └── monitor.ts          # MonitorTarget/MonitorTask/MetricSample/AlertRule 等类型
├── db/
│   ├── schema.sql          # 追加 7 张表（保持幂等 migrate）
│   ├── targets.ts          # monitor_targets CRUD（含敏感字段加密读写）
│   ├── tasks.ts            # monitor_tasks CRUD + next_run_at 调度查询
│   ├── samples.ts          # metric_samples 写入 + 聚合查询 + 清理
│   ├── alert-rules.ts      # alert_rules CRUD
│   ├── alert-events.ts     # alert_events 状态机读写
│   └── feishu.ts           # feishu_webhooks CRUD
├── collectors/
│   ├── index.ts            # 采集器分派器 + Collector 接口
│   ├── newapi-client.ts    # newapi admin HTTP 客户端（注入 Authorization/New-Api-User）
│   ├── newapi-usage.ts
│   ├── newapi-errors.ts
│   ├── newapi-balance.ts
│   ├── newapi-cache.ts
│   └── active-probe.ts     # 复用 lib/providers/
├── alerting/
│   ├── engine.ts           # 规则评估 + 状态机
│   ├── feishu.ts           # 飞书路由器 + 卡片构造 + 签名
│   └── crypto.ts           # AES-256-GCM 敏感字段加解密
└── core/
    └── poller.ts           # 扩展：每 tick 增加 monitor_tasks 调度 + 告警评估
```

---

## 9. 测试策略

现有项目使用 vitest（见 `vitest.config.ts`、`tests/`）。采用 TDD：

- **采集器**：mock newapi HTTP 响应（已核实的 `QuotaData`/`Log`/channel JSON 结构），断言产出的 `MetricSample[]` 正确（含增量时间窗、维度映射、降级/跳过逻辑）。
- **告警引擎**：构造 `metric_samples` 序列，断言聚合/比较/连续次数防抖/状态跳变（正常→firing→resolved）与去重正确。
- **飞书路由**：断言 webhook 选择优先级、卡片 severity 颜色、签名计算；mock fetch 断言失败重试。
- **加密模块**：加密→解密往返一致；密文不含明文；脱敏输出正确。
- **调度**：断言 `next_run_at` 过滤只跑到期任务、跑后正确顺延。
- **DB 层**：用临时 SQLite 文件验证 CRUD 与 schema 幂等迁移。

每个 newapi 接口的真实出入参在编码前以源码二次核实，避免基于假设。

---

## 10. 迁移与上线

1. **Schema 迁移**：追加 6 张表到 `lib/db/schema.sql`，`runMigrations()` 幂等执行（`CREATE TABLE IF NOT EXISTS` + SQLite 用 `ADD COLUMN` 增量）。不影响现有 6 张表。
2. **环境变量**：复用现有 `ADMIN_SESSION_SECRET`（派生加密密钥）；新增可选 `MONITOR_RETENTION_DAYS`（默认复用 `HISTORY_RETENTION_DAYS`）。
3. **向后兼容**：现有 Check CX 看板/轮询/管理后台行为不变；newapi 监控是叠加的新区块与新路由。
4. **渐进上线**：先上目标 + active_probe（无需 admin token 即可见效）→ 再上自有实例拉聚合采集器 → 最后接通告警 + 飞书。
5. **PR 规范**：当前 git user `0xheliuni` 非 newapi 历史核心作者，PR 正文需注明 AI 生成/辅助，并使用 `.github/PULL_REQUEST_TEMPLATE.md`（遵循 newapi CLAUDE.md Rule 8）。

---

## 11. 非目标（YAGNI）

- 不导入 newapi 原始 consume 日志（仅拉聚合）。
- 不引入 Postgres/ClickHouse（SQLite 足够）。
- 不做横向扩展（沿用进程内单例哲学）。
- 不做 firing 期间周期性重发（仅一次 firing + 一次 resolved）。
- 不监控 newapi 进程级系统指标（CPU/内存），聚焦业务指标。

---

## 12. 待确认/实现期核实清单

- `/api/channel/` 返回的渠道余额字段名（编码前核实）。
- newapi 各实例对外是否均为标准 `/v1/chat/completions`（影响 active_probe 默认格式）。
- 缓存统计 `/api/option/channel_affinity_cache` 的返回结构（编码前核实，决定 `cache_hit_rate` 的提取方式）。
