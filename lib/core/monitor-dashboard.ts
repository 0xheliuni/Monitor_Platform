import "server-only";
import { listTargets, getTarget } from "../db/targets";
import { latestSamples } from "../db/samples";
import { listTasks } from "../db/monitor-tasks";
import type { MetricName } from "../types/monitor";

async function latestValue(targetId: string, metric: MetricName): Promise<number | null> {
  const rows = await latestSamples(targetId, metric, 1);
  return rows.length > 0 ? rows[0].value : null;
}

export type TargetOverview = {
  id: string; name: string; kind: string; group_name: string | null; enabled: boolean;
  reachable: number | null; ttft_ms: number | null; error_count: number | null;
};

export async function getTargetsOverview(): Promise<TargetOverview[]> {
  const targets = await listTargets();
  return Promise.all(targets.map(async (t) => ({
    id: t.id, name: t.name, kind: t.kind, group_name: t.group_name, enabled: t.enabled,
    reachable: await latestValue(t.id, "reachable"),
    ttft_ms: await latestValue(t.id, "ttft_ms"),
    error_count: await latestValue(t.id, "error_count"),
  })));
}

export type TargetDetail = {
  id: string; name: string; kind: string; base_url: string; group_name: string | null;
  tasks: Array<{ id: string; name: string; collector_type: string; last_status: string | null; last_run_at: string | null; last_error: string | null }>;
  metrics: Record<string, number | null>;
  channelBalances: Array<{ channel: string | null; value: number; name: string | null }>;
};

export async function getTargetDetail(id: string): Promise<TargetDetail | null> {
  const t = await getTarget(id);
  if (!t) return null;
  const tasks = await listTasks(id);
  const balances = await latestSamples(id, "channel_balance", 100);
  return {
    id: t.id, name: t.name, kind: t.kind, base_url: t.base_url, group_name: t.group_name,
    tasks: tasks.map((k) => ({
      id: k.id, name: k.name, collector_type: k.collector_type,
      last_status: k.last_status, last_run_at: k.last_run_at, last_error: k.last_error,
    })),
    metrics: {
      reachable: await latestValue(id, "reachable"),
      ttft_ms: await latestValue(id, "ttft_ms"),
      ping_ms: await latestValue(id, "ping_ms"),
      error_count: await latestValue(id, "error_count"),
      cache_entries: await latestValue(id, "cache_entries"),
    },
    channelBalances: balances.map((b) => ({
      channel: b.dim_channel, value: b.value,
      name: (b.meta as { name?: string } | null)?.name ?? null,
    })),
  };
}
