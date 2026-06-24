import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toJson, fromJson } from "./json";

export type TemplateRow = {
  id: string;
  name: string;
  type: string;
  request_header: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TemplateRaw = {
  id: string;
  name: string;
  type: string;
  request_header: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(r: TemplateRaw): TemplateRow {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    request_header: fromJson<Record<string, string>>(r.request_header),
    metadata: fromJson<Record<string, unknown>>(r.metadata),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export type TemplateInput = {
  name: string;
  type: string;
  request_header: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
};

export async function listTemplates(): Promise<TemplateRow[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id,name,type,request_header,metadata,created_at,updated_at
     FROM check_request_templates ORDER BY name ASC`
  ).all() as TemplateRaw[];
  return rows.map(mapRow);
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,name,type,request_header,metadata,created_at,updated_at
     FROM check_request_templates WHERE id = ?`
  ).get(id) as TemplateRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createTemplate(input: TemplateInput): Promise<TemplateRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO check_request_templates (id,name,type,request_header,metadata,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, input.name, input.type, toJson(input.request_header), toJson(input.metadata), now, now);
  return (await getTemplate(id))!;
}

export async function updateTemplate(id: string, input: Partial<TemplateInput>): Promise<TemplateRow | null> {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id FROM check_request_templates WHERE id = ?`
  ).get(id);
  if (!existing) return null;
  const now = nowIso();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if ("request_header" in input) { sets.push("request_header = ?"); params.push(toJson(input.request_header ?? null)); }
  if ("metadata" in input) { sets.push("metadata = ?"); params.push(toJson(input.metadata ?? null)); }
  params.push(id);
  db.prepare(`UPDATE check_request_templates SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getTemplate(id);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM check_request_templates WHERE id = ?`).run(id);
}

export async function countModelsByTemplate(id: string): Promise<number> {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM check_models WHERE template_id = ?`
  ).get(id) as { cnt: number };
  return row.cnt;
}
