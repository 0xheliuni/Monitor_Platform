import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool, toJson, fromJson } from "./json";
import type { MonitorTaskRow, CollectorType, TaskStatus } from "../types/monitor";

export type TaskInput = {
  target_id: string;
  name: string;
  collector_type: CollectorType;
  config: Record<string, unknown> | null;
  interval_seconds: number;
  enabled: boolean;
  is_maintenance: boolean;
};

type TaskRaw = {
  id: string; target_id: string; name: string; collector_type: CollectorType;
  config: string | null; interval_seconds: number; enabled: 0 | 1; is_maintenance: 0 | 1;
  next_run_at: string | null; last_run_at: string | null; last_status: TaskStatus | null;
  last_error: string | null; created_at: string; updated_at: string;
};

function mapRow(r: TaskRaw): MonitorTaskRow {
  return {
    id: r.id, target_id: r.target_id, name: r.name, collector_type: r.collector_type,
    config: fromJson<Record<string, unknown>>(r.config),
    interval_seconds: r.interval_seconds, enabled: toBool(r.enabled),
    is_maintenance: toBool(r.is_maintenance), next_run_at: r.next_run_at,
    last_run_at: r.last_run_at, last_status: r.last_status, last_error: r.last_error,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

const COLS = "id,target_id,name,collector_type,config,interval_seconds,enabled,is_maintenance,next_run_at,last_run_at,last_status,last_error,created_at,updated_at";

export async function listTasks(targetId?: string): Promise<MonitorTaskRow[]> {
  const db = getDb();
  const rows = (targetId
    ? db.prepare(`SELECT ${COLS} FROM monitor_tasks WHERE target_id = ? ORDER BY name ASC`).all(targetId)
    : db.prepare(`SELECT ${COLS} FROM monitor_tasks ORDER BY name ASC`).all()) as TaskRaw[];
  return rows.map(mapRow);
}

export async function getTask(id: string): Promise<MonitorTaskRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM monitor_tasks WHERE id = ?`).get(id) as TaskRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createTask(input: TaskInput): Promise<MonitorTaskRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO monitor_tasks (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.target_id, input.name, input.collector_type, toJson(input.config),
    input.interval_seconds, fromBool(input.enabled), fromBool(input.is_maintenance),
    now, null, null, null, now, now
  );
  return (await getTask(id))!;
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<MonitorTaskRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM monitor_tasks WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.collector_type !== undefined) { sets.push("collector_type = ?"); params.push(input.collector_type); }
  if ("config" in input) { sets.push("config = ?"); params.push(toJson(input.config ?? null)); }
  if (input.interval_seconds !== undefined) { sets.push("interval_seconds = ?"); params.push(input.interval_seconds); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  if (input.is_maintenance !== undefined) { sets.push("is_maintenance = ?"); params.push(fromBool(input.is_maintenance)); }
  params.push(id);
  db.prepare(`UPDATE monitor_tasks SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getTask(id);
}

export async function deleteTask(id: string): Promise<void> {
  getDb().prepare("DELETE FROM monitor_tasks WHERE id = ?").run(id);
}

export async function getDueTasks(now: string): Promise<MonitorTaskRow[]> {
  const rows = getDb().prepare(
    `SELECT ${COLS} FROM monitor_tasks
     WHERE enabled = 1 AND is_maintenance = 0
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY next_run_at ASC`
  ).all(now) as TaskRaw[];
  return rows.map(mapRow);
}

export async function recordTaskRun(
  id: string, status: TaskStatus, error: string | null, nextRunAt: string
): Promise<void> {
  getDb().prepare(
    `UPDATE monitor_tasks SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
  ).run(nowIso(), status, error, nextRunAt, nowIso(), id);
}
