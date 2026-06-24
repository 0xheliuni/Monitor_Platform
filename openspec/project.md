# Project Context

## Purpose

Check CX 是一个 AI 模型健康监控面板，用于实时监控 OpenAI、Gemini、Anthropic 等 AI 模型的 API 可用性、延迟和错误信息。

核心功能：
- 后台轮询检测多个 AI Provider 的 API 健康状态
- 实时展示延迟、状态和历史时间线
- 支持动态配置管理（通过数据库启用/禁用检测任务）
- 自定义请求头和请求参数

## Tech Stack

- **框架**: Next.js 14+ (App Router)
- **语言**: TypeScript
- **数据库**: SQLite (better-sqlite3)
- **AI SDK**: Vercel AI SDK
- **样式**: Tailwind CSS
- **包管理**: pnpm
- **部署**: Docker
- **测试**: vitest (in-memory SQLite)

## Project Conventions

### Code Style

- **模块职责**: 每个模块专注单一功能，文件不超过 200 行
- **类型导出**: 所有类型从 `lib/types/index.ts` 统一导出
- **命名规范**:
  - 文件名使用 kebab-case（如 `dashboard-data.ts`）
  - 函数名使用 camelCase（如 `runProviderChecks`）
  - 类型名使用 PascalCase（如 `CheckResult`）
- **错误处理**: 使用 `lib/utils/error-handler.ts` 的 `logError()` 统一记录错误
- **className 合并**: 使用 `lib/utils/cn.ts` 处理 Tailwind className

### Architecture Patterns

项目采用分层架构：

```
lib/
├── types/          # 统一类型定义
├── providers/      # Provider 检查逻辑（OpenAI、Gemini、Anthropic）
├── db/             # SQLite 数据层（schema.sql、migrations、查询）
├── database/       # 公开数据库接口（配置加载、历史记录）
├── admin/          # Admin 操作接口
├── utils/          # 工具函数
└── core/           # 核心模块（轮询器、全局状态、Dashboard 数据）
```

**数据流向**:
- **后台 → 数据库**: `poller.ts` → `providers/` → `lib/db/*` (SQLite)
- **数据库 → 前端**: `lib/database/*` → `dashboard-data.ts` → `page.tsx` → `dashboard-view.tsx`
- **Admin 操作**: `/admin/*` → `lib/admin/*` → `lib/db/*` (SQLite)

**关键模式**:
- 后台轮询系统在应用启动时自动初始化，单进程在内存单例（无多节点租赁）
- 使用全局状态防止 Next.js 热重载时重复创建定时器
- 所有 Provider 使用流式 API，接收首个响应块即判定成功
- Dashboard 数据使用基于轮询间隔的缓存
- 数据库 schema 在 `lib/db/schema.sql` 中定义，应用启动时通过 `runMigrations` 构建

### Testing Strategy

项目使用 vitest 进行自动化测试，采用 in-memory SQLite 进行数据库测试：
1. 单元测试和集成测试在 in-memory SQLite 上执行
2. 本地开发运行 `pnpm dev` 验证功能
3. 检查服务器日志确认轮询正常执行
4. 验证 Dashboard 数据刷新正常

### Git Workflow

- **主分支**: `master`
- **提交信息**: 中文描述，格式如 `chore: 移除配置` / `fix: 修复问题` / `feat: 添加功能`
- **提交前**: 运行 `pnpm lint` 检查代码

## Domain Context

### 状态判定规则

- `operational`: 请求成功且延迟 ≤ 6000ms
- `degraded`: 请求成功但延迟 > 6000ms
- `failed`: 请求失败或超时（默认超时 15 秒）

### Provider 类型

| 类型 | API 端点格式 | 认证方式 |
|------|-------------|---------|
| openai | `/v1/chat/completions` | Bearer Token |
| gemini | `/models/{model}:streamGenerateContent` | API Key 查询参数 |
| anthropic | `/v1/messages` | `x-api-key` + `anthropic-version` 头 |

### 轮询配置

- 默认间隔: 60 秒
- 支持范围: 15-600 秒
- 环境变量: `CHECK_POLL_INTERVAL_SECONDS`

## Important Constraints

- **数据保留**: 每个配置最多保留 60 条历史记录
- **查询窗口**: 前端仅展示最近 1 小时内的数据
- **请求限制**: 所有请求设置 `max_tokens: 1` 最小化响应
- **超时控制**: 所有网络请求 15 秒超时
- **并发控制**: 使用标志位防止多个检测任务重叠执行

## External Dependencies

### SQLite 数据库

本地关系型数据库，存储配置和历史记录：

**环境变量**:
- `SQLITE_DB_PATH`: SQLite 数据库文件路径（默认 `./data/db.sqlite`）
- `ADMIN_LOGIN_KEY`: Admin 登录密钥
- `ADMIN_SESSION_SECRET`: Admin 会话加密密钥
- `APP_URL`: 应用基础 URL
- `CHECK_POLL_INTERVAL_SECONDS`: 轮询间隔秒数
- `HISTORY_RETENTION_DAYS`: 历史记录保留天数
- `CHECK_CONCURRENCY`: 并发检测任务数
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`: 官方状态检查间隔秒数

**数据库结构**:
- Schema 定义在 `lib/db/schema.sql`
- 数据库迁移在应用启动时通过 `runMigrations` 自动执行
- 配置管理：使用 `sqlite3` CLI 直接编辑 SQLite DB
- 表：`check_configs`（Provider 配置）、`check_history`（检测历史）

### AI Provider APIs

- OpenAI API (`api.openai.com`)
- Google Gemini API (`generativelanguage.googleapis.com`)
- Anthropic API (`api.anthropic.com`)
- 支持自定义第三方代理端点
