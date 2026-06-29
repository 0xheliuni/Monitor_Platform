import "server-only";
import { newapiGet, isoToUnix } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type QuotaData = {
  model_name: string; username: string; created_at: number;
  token_used: number; count: number; quota: number;
};

export async function collectUsage(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const start = task.last_run_at ?? new Date(Date.parse(now) - task.interval_seconds * 1000).toISOString();
  const data = (await newapiGet(target, "/api/data", {
    start_timestamp: isoToUnix(start),
    end_timestamp: isoToUnix(now),
  })) as QuotaData[] | null;
  const rows = data ?? [];
  const samples: SampleInput[] = [];
  for (const r of rows) {
    const dims = { dim_model: r.model_name || null, dim_user: r.username || null };
    samples.push(
      { task_id: task.id, target_id: target.id, metric: "usage_quota", value: r.quota, checked_at: now, ...dims },
      { task_id: task.id, target_id: target.id, metric: "usage_tokens", value: r.token_used, checked_at: now, ...dims },
      { task_id: task.id, target_id: target.id, metric: "request_count", value: r.count, checked_at: now, ...dims },
    );
  }
  return samples;
}
