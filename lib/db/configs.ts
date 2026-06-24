import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool, fromJson } from "./json";

export type ConfigRow = {
  id: string;
  name: string;
  type: string;
  model_id: string;
  endpoint: string;
  api_key: string;
  enabled: boolean;
  is_maintenance: boolean;
  group_name: string | null;
  created_at: string;
  updated_at: string;
};

type ConfigRaw = {
  id: string;
  name: string;
  type: string;
  model_id: string;
  endpoint: string;
  api_key: string;
  enabled: 0 | 1;
  is_maintenance: 0 | 1;
  group_name: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(r: ConfigRaw): ConfigRow {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    model_id: r.model_id,
    endpoint: r.endpoint,
    api_key: r.api_key,
    enabled: toBool(r.enabled),
    is_maintenance: toBool(r.is_maintenance),
    group_name: r.group_name,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export type ConfigInput = {
  name: string;
  type: string;
  model_id: string;
  endpoint: string;
  api_key: string;
  enabled: boolean;
  is_maintenance: boolean;
  group_name: string | null;
};

async function checkModelType(model_id: string, configType: string): Promise<void> {
  const db = getDb();
  const model = db.prepare(
    `SELECT type FROM check_models WHERE id = ?`
  ).get(model_id) as { type: string } | undefined;
  if (!model) throw new Error("模型不存在");
  if (model.type !== configType) throw new Error("模型类型不匹配");
}

export async function listConfigs(scopeGroup?: string | null): Promise<ConfigRow[]> {
  const db = getDb();
  let sql = `SELECT id,name,type,model_id,endpoint,api_key,enabled,is_maintenance,group_name,created_at,updated_at
             FROM check_configs`;
  const params: unknown[] = [];
  if (scopeGroup && scopeGroup.length > 0) {
    sql += ` WHERE group_name = ?`;
    params.push(scopeGroup);
  }
  sql += ` ORDER BY name ASC`;
  const rows = db.prepare(sql).all(...params) as ConfigRaw[];
  return rows.map(mapRow);
}

export async function getConfig(id: string): Promise<ConfigRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,name,type,model_id,endpoint,api_key,enabled,is_maintenance,group_name,created_at,updated_at
     FROM check_configs WHERE id = ?`
  ).get(id) as ConfigRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createConfig(input: ConfigInput): Promise<ConfigRow> {
  await checkModelType(input.model_id, input.type);
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,enabled,is_maintenance,group_name,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.type, input.model_id, input.endpoint, input.api_key,
    fromBool(input.enabled), fromBool(input.is_maintenance), input.group_name, now, now
  );
  return (await getConfig(id))!;
}

export async function updateConfig(id: string, input: Partial<ConfigInput>): Promise<ConfigRow | null> {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id,type,model_id FROM check_configs WHERE id = ?`
  ).get(id) as { id: string; type: string; model_id: string } | undefined;
  if (!existing) return null;

  if (input.type !== undefined || input.model_id !== undefined) {
    const newType = input.type ?? existing.type;
    const newModelId = input.model_id ?? existing.model_id;
    await checkModelType(newModelId, newType);
  }

  const now = nowIso();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.model_id !== undefined) { sets.push("model_id = ?"); params.push(input.model_id); }
  if (input.endpoint !== undefined) { sets.push("endpoint = ?"); params.push(input.endpoint); }
  if (input.api_key !== undefined) { sets.push("api_key = ?"); params.push(input.api_key); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  if (input.is_maintenance !== undefined) { sets.push("is_maintenance = ?"); params.push(fromBool(input.is_maintenance)); }
  if ("group_name" in input) { sets.push("group_name = ?"); params.push(input.group_name ?? null); }
  params.push(id);
  db.prepare(`UPDATE check_configs SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getConfig(id);
}

export async function deleteConfig(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM check_configs WHERE id = ?`).run(id);
}

export async function setConfigsEnabled(ids: string[], enabled: boolean): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE check_configs SET enabled = ?, updated_at = ? WHERE id IN (${placeholders})`
  ).run([fromBool(enabled), nowIso(), ...ids]);
}

export async function deleteHistoryByConfig(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM check_history WHERE config_id = ?`).run(id);
}

export type ConfigWithModelTemplate = {
  id: string; name: string; type: string; endpoint: string; api_key: string;
  is_maintenance: boolean; group_name: string | null; model: string;
  request_header: Record<string, string> | null; metadata: Record<string, unknown> | null;
};

export async function loadEnabledConfigsWithModelTemplate(): Promise<ConfigWithModelTemplate[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.id,c.name,c.type,c.endpoint,c.api_key,c.is_maintenance,c.group_name,
            m.model AS model, m.type AS model_type,
            t.type AS tpl_type, t.request_header AS request_header, t.metadata AS metadata
     FROM check_configs c
     JOIN check_models m ON m.id = c.model_id
     LEFT JOIN check_request_templates t ON t.id = m.template_id
     WHERE c.enabled = 1
     ORDER BY c.id`
  ).all() as Array<{
    id: string; name: string; type: string; endpoint: string; api_key: string;
    is_maintenance: number; group_name: string | null; model: string; model_type: string;
    tpl_type: string | null; request_header: string | null; metadata: string | null;
  }>;
  return rows
    .filter((r) => r.model_type === r.type)
    .map((r) => ({
    id: r.id, name: r.name, type: r.type, endpoint: r.endpoint, api_key: r.api_key,
    is_maintenance: toBool(r.is_maintenance as 0 | 1), group_name: r.group_name,
    model: r.model,
    request_header: r.tpl_type === r.type ? fromJson<Record<string, string>>(r.request_header) : null,
    metadata: r.tpl_type === r.type ? fromJson<Record<string, unknown>>(r.metadata) : null,
  }));
}
