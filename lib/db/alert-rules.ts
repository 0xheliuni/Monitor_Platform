import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool } from "./json";
import type { AlertRuleRow, MetricName, Comparator, Aggregation, AlertSeverity } from "../types/monitor";

export type RuleInput = {
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
};

type RuleRaw = Omit<AlertRuleRow, "enabled"> & { enabled: 0 | 1 };

const COLS = "id,name,target_id,task_id,metric,comparator,threshold,window_seconds,aggregation,consecutive_breaches,severity,feishu_webhook_id,enabled,created_at,updated_at";

function mapRow(r: RuleRaw): AlertRuleRow {
  return { ...r, enabled: toBool(r.enabled) };
}

export async function listRules(): Promise<AlertRuleRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM alert_rules ORDER BY name ASC`).all() as RuleRaw[];
  return rows.map(mapRow);
}

export async function listEnabledRules(): Promise<AlertRuleRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM alert_rules WHERE enabled = 1`).all() as RuleRaw[];
  return rows.map(mapRow);
}

export async function getRule(id: string): Promise<AlertRuleRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM alert_rules WHERE id = ?`).get(id) as RuleRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createRule(input: RuleInput): Promise<AlertRuleRow> {
  const id = newId();
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO alert_rules (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.target_id, input.task_id, input.metric, input.comparator,
    input.threshold, input.window_seconds, input.aggregation, input.consecutive_breaches,
    input.severity, input.feishu_webhook_id, fromBool(input.enabled), now, now
  );
  return (await getRule(id))!;
}

export async function updateRule(id: string, input: Partial<RuleInput>): Promise<AlertRuleRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM alert_rules WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  const scalar: (keyof RuleInput)[] = ["name","metric","comparator","threshold","window_seconds","aggregation","consecutive_breaches","severity"];
  for (const f of scalar) {
    if (input[f] !== undefined) { sets.push(`${f} = ?`); params.push(input[f]); }
  }
  if ("target_id" in input) { sets.push("target_id = ?"); params.push(input.target_id ?? null); }
  if ("task_id" in input) { sets.push("task_id = ?"); params.push(input.task_id ?? null); }
  if ("feishu_webhook_id" in input) { sets.push("feishu_webhook_id = ?"); params.push(input.feishu_webhook_id ?? null); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  params.push(id);
  db.prepare(`UPDATE alert_rules SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getRule(id);
}

export async function deleteRule(id: string): Promise<void> {
  getDb().prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
}
