# Monitor Platform

Monitor Platform 是一个单应用架构的 AI 模型 API 健康监测面板，基于 **Next.js App Router** 与本地 **SQLite** 构建。公开 Dashboard、后台管理、健康检查轮询三部分运行在同一个 Next.js 进程中，无需外部数据库服务。

## 架构概览

```
┌─────────────────────────────────────────────┐
│              Next.js 单进程                  │
│                                             │
│  /           公开 Dashboard（只读展示）       │
│  /admin      后台管理（模板 / 模型 / 配置）   │
│  /api/*      REST API                       │
│                                             │
│  instrumentation.ts                         │
│    ├── runMigrations()  启动时建表           │
│    └── poller           后台轮询检测         │
│                                             │
│  SQLite（better-sqlite3）                   │
│    └── data/monitor.db  持久化文件           │
└─────────────────────────────────────────────┘
```

**重要限制：** 轮询器运行在单进程中，**不支持水平扩展（多副本部署）**。多副本会导致重复检测写入。如需高可用，请在反向代理层保证只有一个实例运行轮询。

## 快速开始

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 ADMIN_LOGIN_KEY 与 ADMIN_SESSION_SECRET（各 ≥32 字节随机值）

# 3. 启动开发服务器（首次启动自动建表）
pnpm dev
```

访问 `http://localhost:3000` 查看公开面板，访问 `http://localhost:3000/admin` 进入后台管理。

### 生成随机密钥

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 生产构建

```bash
pnpm build
pnpm start
```

## Docker 部署

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f monitor
```

`data/` 目录通过 volume 挂载到宿主机，SQLite 数据库持久化在 `./data/monitor.db`。

### WAL 模式

数据库在初始化时自动开启 WAL（Write-Ahead Logging）模式，提升并发读取性能。WAL 相关文件（`monitor.db-wal`、`monitor.db-shm`）属正常现象，不要单独删除。

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `SQLITE_DB_PATH` | 否 | `./data/monitor.db` | SQLite 数据库文件路径 |
| `ADMIN_LOGIN_KEY` | 是 | — | 后台登录密码（建议 ≥32 字节随机值） |
| `ADMIN_SESSION_SECRET` | 是 | — | Session 签名密钥（建议 ≥32 字节随机值） |
| `APP_URL` | 否 | `http://localhost:3000` | 应用外部访问地址 |
| `CHECK_POLL_INTERVAL_SECONDS` | 否 | `60` | 健康检测轮询间隔（秒） |
| `CHECK_CONCURRENCY` | 否 | `8` | 最大并发检测数 |
| `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS` | 否 | `60` | 官方状态页轮询间隔（秒） |
| `HISTORY_RETENTION_DAYS` | 否 | `30` | 历史记录保留天数 |

## 后台管理

访问 `/admin/login`，输入 `ADMIN_LOGIN_KEY` 登录。登录后可：

- 管理 **Request Templates**（请求模板：Headers、Metadata）
- 管理 **Models**（模型定义，绑定模板）
- 管理 **Configs**（检测配置：Endpoint、API Key、启用/禁用）

新建配置后，轮询器在下一个周期自动纳入检测。

## API

- `GET /api/dashboard?trendPeriod=7d|15d|30d` — Dashboard 聚合数据（带 ETag）
- `GET /api/group/[groupName]?trendPeriod=7d|15d|30d` — 分组详情
- `GET /api/v1/status?group=...&model=...` — 只读状态 API

## 运行与命令

```bash
pnpm dev        # 本地开发（热重载）
pnpm build      # 生产构建
pnpm start      # 生产运行
pnpm test       # 运行测试（vitest）
pnpm lint       # 代码检查
```

## 许可证

[MIT](LICENSE)
