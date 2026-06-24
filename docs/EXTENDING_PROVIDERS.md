# 扩展 Provider 与官方状态

本文档说明如何在当前架构下新增 Provider 类型或接入官方状态检查。请先评估是否真的需要新增类型：

- 若目标服务兼容 OpenAI Chat/Responses 接口，可直接使用 `type = openai` 并配置对应 `endpoint`，无需新增代码。
- 仅当接口协议与现有 Provider 明显不同，才需要新增 Provider 类型。

## 1. 扩展 Provider 类型

### 1.1 数据库枚举与 Schema

`check_configs.type` 存储在本地 SQLite 数据库中。新增 Provider 必须更新 schema：

- 编辑 `lib/db/schema.sql` 更新 check_configs、check_models、check_request_templates 表的约束或默认值（如需）
- 使用 `sqlite3 cli` 或应用 API 直接修改 SQLite 数据库中的配置记录

### 1.2 类型与 UI 标识

修改以下文件：

- `lib/types/provider.ts`：扩展 `ProviderType` 与 `DEFAULT_ENDPOINTS`
- `lib/core/status.ts`：补充 `PROVIDER_LABEL`
- `components/provider-icon.tsx`：为新 Provider 提供图标（或明确使用占位图标）

## 2. 实现健康检查

健康检查由 `lib/providers/ai-sdk-check.ts` 统一负责。

步骤：

1. 在 `createModel` 中新增 `case`，返回 AI SDK 模型实例。
2. 选择合适的 Provider SDK（如 `@ai-sdk/openai-compatible`）。
3. 如需自定义请求头与请求体参数，放到 `check_request_templates`，再由 `check_models.template_id` 绑定。

示例结构（仅示意）：

```ts
case "myvendor": {
  const provider = createOpenAICompatible({
    name: "myvendor",
    apiKey: config.apiKey,
    baseURL,
    fetch: customFetch,
  });
  return { model: provider(modelId), reasoningEffort: undefined, isResponses: false };
}
```

如果 Provider 不支持流式输出或行为异常，请直接在 `ai-sdk-check.ts` 内处理错误与超时分支，保持返回结构不变。

## 3. 官方状态检查（可选）

官方状态检查位于 `lib/official-status/`。

步骤：

1. 新增 `lib/official-status/<provider>.ts`，实现 `check<Provider>Status()`。
2. 在 `lib/official-status/index.ts` 注册新方法。
3. 在 `lib/core/official-status-poller.ts` 的 `allTypes` 列表中加入新类型。

## 4. 数据库配置

新增 Provider 后，使用 `sqlite3` CLI 或应用程序向本地 SQLite 数据库插入配置。表结构定义在 `lib/db/schema.sql`，IDs 由应用生成（`crypto.randomUUID()` 转小写十六进制），时间戳为 ISO8601 TEXT 格式：

```sql
-- 1) 注册模板
INSERT INTO check_request_templates (id, name, type, created_at)
VALUES ('550e8400e29b41d4a716446655440000', 'myvendor-default', 'myvendor', '2026-06-24T10:00:00Z')
ON CONFLICT (name) DO NOTHING;

-- 2) 注册模型
INSERT INTO check_models (id, type, model, template_id, created_at)
VALUES ('660e8400e29b41d4a716446655440001', 'myvendor', 'my-model', '550e8400e29b41d4a716446655440000', '2026-06-24T10:00:00Z')
ON CONFLICT (type, model) DO NOTHING;

-- 3) 绑定到配置实例
INSERT INTO check_configs (id, name, type, model_id, endpoint, api_key, enabled, created_at, updated_at)
VALUES ('770e8400e29b41d4a716446655440002',
        'MyVendor 主力',
        'myvendor',
        '660e8400e29b41d4a716446655440001',
        'https://api.myvendor.com/v1/chat/completions',
        'sk-xxx',
        true,
        '2026-06-24T10:00:00Z',
        '2026-06-24T10:00:00Z');
```

如果同一模型需要统一默认参数，请更新 `check_request_templates.request_header` / `check_request_templates.metadata`，再把模板绑定到 `check_models.template_id`。

## 5. 验证清单

- 轮询日志出现新 Provider 记录
- Dashboard 卡片可见并显示延迟
- 官方状态（若已实现）显示正确
- 状态 API `GET /api/v1/status` 返回新 Provider
