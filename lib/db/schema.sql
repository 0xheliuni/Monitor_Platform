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
