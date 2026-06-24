import "server-only";
import { getDb } from "./client";
import { nowIso } from "./json";

export type RecentHistoryRow = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
  name: string; type: string; model: string; endpoint: string | null; group_name: string | null;
};
export type HistoryInsert = {
  config_id: string; status: string; latency_ms: number | null;
  ping_latency_ms: number | null; checked_at: string; message: string | null;
};

export async function insertHistory(records: HistoryInsert[]): Promise<void> {
  if (records.length === 0) return;
  const db = getDb();
  const created = nowIso();
  const stmt = db.prepare(
    `INSERT INTO check_history (config_id,status,latency_ms,ping_latency_ms,checked_at,message,created_at)
     VALUES (@config_id,@status,@latency_ms,@ping_latency_ms,@checked_at,@message,@created_at)`
  );
  const tx = db.transaction((rows: HistoryInsert[]) => {
    for (const r of rows) stmt.run({ ...r, created_at: created });
  });
  tx(records);
}

export async function getRecentCheckHistory(
  limitPerConfig: number,
  targetConfigIds: string[] | null
): Promise<RecentHistoryRow[]> {
  const db = getDb();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `WHERE h.config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const sql = `
    WITH ranked AS (
      SELECT h.config_id, h.status, h.latency_ms, h.ping_latency_ms, h.checked_at, h.message,
             row_number() OVER (PARTITION BY h.config_id ORDER BY h.checked_at DESC) AS rn
      FROM check_history h ${filter}
    )
    SELECT r.config_id, r.status, r.latency_ms, r.ping_latency_ms, r.checked_at, r.message,
           c.name, c.type, m.model, c.endpoint, c.group_name
    FROM ranked r
    JOIN check_configs c ON c.id = r.config_id
    JOIN check_models m ON m.id = c.model_id
    WHERE r.rn <= ?
    ORDER BY c.name ASC, r.checked_at DESC`;
  const params = targetConfigIds && targetConfigIds.length > 0
    ? [...targetConfigIds, limitPerConfig] : [limitPerConfig];
  return db.prepare(sql).all(...params) as RecentHistoryRow[];
}

export async function pruneCheckHistory(retentionDays: number): Promise<number> {
  const db = getDb();
  const effective = Math.min(365, Math.max(7, retentionDays || 30));
  const cutoff = new Date(Date.now() - effective * 86400000).toISOString();
  const info = db.prepare("DELETE FROM check_history WHERE checked_at < ?").run(cutoff);
  return info.changes;
}

export async function getCheckHistoryByTime(
  sinceMs: number,
  targetConfigIds: string[] | null,
  maxPointsPerConfig: number
): Promise<{ config_id: string; status: string; latency_ms: number | null; checked_at: string }[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const filter = targetConfigIds && targetConfigIds.length > 0
    ? `AND config_id IN (${targetConfigIds.map(() => "?").join(",")})`
    : "";
  const params = targetConfigIds && targetConfigIds.length > 0 ? [cutoff, ...targetConfigIds] : [cutoff];
  const all = db.prepare(
    `SELECT config_id, status, latency_ms, checked_at FROM check_history
     WHERE checked_at > ? ${filter} ORDER BY config_id, checked_at ASC`
  ).all(...params) as { config_id: string; status: string; latency_ms: number | null; checked_at: string }[];

  const byConfig = new Map<string, typeof all>();
  for (const row of all) {
    const list = byConfig.get(row.config_id);
    if (list) list.push(row); else byConfig.set(row.config_id, [row]);
  }
  const result: typeof all = [];
  for (const list of byConfig.values()) {
    const total = list.length;
    const step = Math.max(1, Math.floor(total / maxPointsPerConfig));
    list.forEach((row, i) => {
      if (i === 0 || i === total - 1 || i % step === 0) result.push(row);
    });
  }
  return result;
}
