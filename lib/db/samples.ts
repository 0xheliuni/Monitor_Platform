import "server-only";
import { getDb } from "./client";
import { toJson, fromJson } from "./json";
import type { MetricSampleRow, MetricName, Aggregation } from "../types/monitor";

export type SampleInput = {
  task_id: string | null;
  target_id: string;
  metric: MetricName;
  dim_model?: string | null;
  dim_user?: string | null;
  dim_channel?: string | null;
  value: number;
  checked_at: string;
  meta?: Record<string, unknown> | null;
};

type SampleRaw = {
  id: number; task_id: string | null; target_id: string; metric: MetricName;
  dim_model: string | null; dim_user: string | null; dim_channel: string | null;
  value: number; checked_at: string; meta: string | null;
};

function mapRow(r: SampleRaw): MetricSampleRow {
  return {
    id: r.id, task_id: r.task_id, target_id: r.target_id, metric: r.metric,
    dim_model: r.dim_model, dim_user: r.dim_user, dim_channel: r.dim_channel,
    value: r.value, checked_at: r.checked_at, meta: fromJson<Record<string, unknown>>(r.meta),
  };
}

export async function insertSamples(samples: SampleInput[]): Promise<void> {
  if (samples.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO metric_samples (task_id,target_id,metric,dim_model,dim_user,dim_channel,value,checked_at,meta)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const tx = db.transaction((rows: SampleInput[]) => {
    for (const s of rows) {
      stmt.run(
        s.task_id, s.target_id, s.metric, s.dim_model ?? null, s.dim_user ?? null,
        s.dim_channel ?? null, s.value, s.checked_at, toJson(s.meta ?? null)
      );
    }
  });
  tx(samples);
}

const AGG_FN: Record<Exclude<Aggregation, "last">, string> = {
  sum: "SUM(value)", avg: "AVG(value)", max: "MAX(value)", min: "MIN(value)", count: "COUNT(*)",
};

export async function aggregateWindow(opts: {
  targetId?: string | null;
  taskId?: string | null;
  metric: MetricName;
  sinceIso: string;
  aggregation: Aggregation;
}): Promise<number | null> {
  const db = getDb();
  const where: string[] = ["metric = ?", "checked_at >= ?"];
  const params: unknown[] = [opts.metric, opts.sinceIso];
  if (opts.targetId) { where.push("target_id = ?"); params.push(opts.targetId); }
  if (opts.taskId) { where.push("task_id = ?"); params.push(opts.taskId); }
  const whereSql = where.join(" AND ");

  if (opts.aggregation === "last") {
    const row = db.prepare(
      `SELECT value FROM metric_samples WHERE ${whereSql} ORDER BY checked_at DESC, id DESC LIMIT 1`
    ).get(...params) as { value: number } | undefined;
    return row ? row.value : null;
  }
  const row = db.prepare(
    `SELECT ${AGG_FN[opts.aggregation]} AS v FROM metric_samples WHERE ${whereSql}`
  ).get(...params) as { v: number | null };
  if (opts.aggregation === "count") return row.v ?? 0;
  return row.v ?? null;
}

export async function latestSamples(targetId: string, metric: MetricName, limit: number): Promise<MetricSampleRow[]> {
  const rows = getDb().prepare(
    `SELECT * FROM metric_samples WHERE target_id = ? AND metric = ? ORDER BY checked_at DESC, id DESC LIMIT ?`
  ).all(targetId, metric, limit) as SampleRaw[];
  return rows.map(mapRow);
}

export async function querySeries(targetId: string, metric: MetricName, fromIso: string, toIso: string): Promise<MetricSampleRow[]> {
  const rows = getDb().prepare(
    `SELECT * FROM metric_samples WHERE target_id = ? AND metric = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC`
  ).all(targetId, metric, fromIso, toIso) as SampleRaw[];
  return rows.map(mapRow);
}

export async function cleanupSamples(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
  const info = getDb().prepare("DELETE FROM metric_samples WHERE checked_at < ?").run(cutoff);
  return info.changes;
}
