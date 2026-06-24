import "server-only";
import { getDb } from "./client";
import { newId, nowIso } from "./json";

export type ModelRow = {
  id: string;
  type: string;
  model: string;
  template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ModelInput = {
  type: string;
  model: string;
  template_id?: string | null;
};

async function checkTemplateType(template_id: string, modelType: string): Promise<void> {
  const db = getDb();
  const tpl = db.prepare(
    `SELECT type FROM check_request_templates WHERE id = ?`
  ).get(template_id) as { type: string } | undefined;
  if (!tpl) throw new Error("模板不存在");
  if (tpl.type !== modelType) throw new Error("模板类型不匹配");
}

export async function listModels(): Promise<ModelRow[]> {
  const db = getDb();
  return db.prepare(
    `SELECT id,type,model,template_id,created_at,updated_at FROM check_models ORDER BY type ASC, model ASC`
  ).all() as ModelRow[];
}

export async function getModel(id: string): Promise<ModelRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,type,model,template_id,created_at,updated_at FROM check_models WHERE id = ?`
  ).get(id) as ModelRow | undefined;
  return row ?? null;
}

export async function createModel(input: ModelInput): Promise<ModelRow> {
  if (input.template_id) {
    await checkTemplateType(input.template_id, input.type);
  }
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO check_models (id,type,model,template_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?)`
  ).run(id, input.type, input.model, input.template_id ?? null, now, now);
  return (await getModel(id))!;
}

export async function updateModel(id: string, input: Partial<ModelInput>): Promise<ModelRow | null> {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id,type,template_id FROM check_models WHERE id = ?`
  ).get(id) as { id: string; type: string; template_id: string | null } | undefined;
  if (!existing) return null;

  const newType = input.type ?? existing.type;
  const newTemplateId = "template_id" in input ? (input.template_id ?? null) : existing.template_id;

  if (newTemplateId) {
    await checkTemplateType(newTemplateId, newType);
  }

  const now = nowIso();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.model !== undefined) { sets.push("model = ?"); params.push(input.model); }
  if ("template_id" in input) { sets.push("template_id = ?"); params.push(input.template_id ?? null); }
  params.push(id);
  db.prepare(`UPDATE check_models SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getModel(id);
}

export async function deleteModel(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM check_models WHERE id = ?`).run(id);
}

export async function countConfigsByModel(id: string): Promise<number> {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) AS cnt FROM check_configs WHERE model_id = ?`
  ).get(id) as { cnt: number };
  return row.cnt;
}
