import "server-only";
import { getDb } from "./client";
import { newId } from "./json";
import type { AlertEventRow, AlertState } from "../types/monitor";

const COLS = "id,rule_id,state,breach_count,first_seen_at,last_seen_at,resolved_at,last_notified_at,message";

export async function getEventByRule(ruleId: string): Promise<AlertEventRow | null> {
  return (getDb().prepare(`SELECT ${COLS} FROM alert_events WHERE rule_id = ?`).get(ruleId) as AlertEventRow | undefined) ?? null;
}

export type EventPatch = {
  state?: AlertState;
  breach_count?: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  resolved_at?: string | null;
  last_notified_at?: string | null;
  message?: string | null;
};

export async function upsertEvent(ruleId: string, patch: EventPatch): Promise<AlertEventRow> {
  const db = getDb();
  const existing = await getEventByRule(ruleId);
  if (!existing) {
    const id = newId();
    db.prepare(
      `INSERT INTO alert_events (id,rule_id,state,breach_count,first_seen_at,last_seen_at,resolved_at,last_notified_at,message)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      id, ruleId, patch.state ?? "firing", patch.breach_count ?? 0,
      patch.first_seen_at ?? null, patch.last_seen_at ?? null, patch.resolved_at ?? null,
      patch.last_notified_at ?? null, patch.message ?? null
    );
    return (await getEventByRule(ruleId))!;
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  const fields: (keyof EventPatch)[] = ["state","breach_count","first_seen_at","last_seen_at","resolved_at","last_notified_at","message"];
  for (const f of fields) {
    if (f in patch) { sets.push(`${f} = ?`); params.push(patch[f] ?? null); }
  }
  if (sets.length > 0) {
    params.push(ruleId);
    db.prepare(`UPDATE alert_events SET ${sets.join(",")} WHERE rule_id = ?`).run(...params);
  }
  return (await getEventByRule(ruleId))!;
}

export async function listRecentEvents(limit: number): Promise<AlertEventRow[]> {
  return getDb().prepare(
    `SELECT ${COLS} FROM alert_events ORDER BY COALESCE(last_seen_at, first_seen_at) DESC LIMIT ?`
  ).all(limit) as AlertEventRow[];
}
