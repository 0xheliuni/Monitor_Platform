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
