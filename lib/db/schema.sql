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
