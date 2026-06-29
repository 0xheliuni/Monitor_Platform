import "server-only";
import { newapiGet } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type CacheStats = { Enabled: boolean; Total: number; Unknown: number; ByRuleName: Record<string, number> };

export async function collectCache(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const data = (await newapiGet(target, "/api/option/channel_affinity_cache")) as CacheStats | null;
  if (!data) return [];
  return [{
    task_id: task.id, target_id: target.id, metric: "cache_entries" as const,
    value: data.Total ?? 0, checked_at: now,
    meta: { Enabled: data.Enabled, Unknown: data.Unknown, ByRuleName: data.ByRuleName },
  }];
}
