# ============================================
# Stage 1: 基础镜像 + pnpm
# ============================================
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

# ============================================
# Stage 2: 安装依赖（含原生编译工具链）
# ============================================
FROM base AS deps
WORKDIR /app

# 安装 better-sqlite3 原生编译所需工具链
RUN apk add --no-cache python3 make g++

# 复制依赖清单
COPY package.json pnpm-lock.yaml ./

# 安装生产依赖（pnpm.onlyBuiltDependencies 控制 better-sqlite3 原生编译）
RUN pnpm install --frozen-lockfile

# pnpm 用符号链接把包指向 .pnpm 虚拟仓库，直接 COPY better-sqlite3 只会拷到
# 悬空链接（运行时缺少 .node 二进制导致启动崩溃）。用 cp -RL 解引用，物化成
# 真实目录，供 runner 阶段拷贝。
RUN mkdir -p /native-deps && \
    cp -RL /app/node_modules/better-sqlite3 /native-deps/better-sqlite3 && \
    cp -RL /app/node_modules/bindings /native-deps/bindings && \
    cp -RL /app/node_modules/file-uri-to-path /native-deps/file-uri-to-path

# ============================================
# Stage 3: 构建应用
# ============================================
FROM base AS builder
WORKDIR /app

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建 Next.js (standalone 模式)
RUN pnpm build

# ============================================
# Stage 4: 生产运行时
# ============================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制 standalone 构建产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 复制 schema.sql（runMigrations 在运行时通过 process.cwd()+lib/db/schema.sql 读取）
COPY --from=builder /app/lib/db/schema.sql ./lib/db/schema.sql

# 复制 better-sqlite3 原生 .node 二进制（standalone 不自动携带）
# 来源是 deps 阶段解引用后的真实目录，避免 pnpm 符号链接在 runner 中悬空。
COPY --from=deps /native-deps/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps /native-deps/bindings ./node_modules/bindings
COPY --from=deps /native-deps/file-uri-to-path ./node_modules/file-uri-to-path

# 创建数据目录并设置权限
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
