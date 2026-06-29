import "server-only";
import { newapiGet, isoToUnix } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type LogItem = {
  channel: number; channel_name?: string; model_name?: string;
  created_at: number; content?: string;
};

export async function collectErrors(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const start = task.last_run_at ?? new Date(Date.parse(now) - task.interval_seconds * 1000).toISOString();
  const data = (await newapiGet(target, "/api/log", {
    type: 5,
    start_timestamp: isoToUnix(start),
    end_timestamp: isoToUnix(now),
    p: 1,
    page_size: 100,
  })) as { items?: LogItem[]; total?: number } | null;
  const items = data?.items ?? [];

  const byChannel = new Map<number, { count: number; name?: string; lastContent?: string }>();
  for (const it of items) {
    const cur = byChannel.get(it.channel) ?? { count: 0, name: it.channel_name };
    cur.count += 1;
    cur.lastContent = it.content;
    byChannel.set(it.channel, cur);
  }

  const samples: SampleInput[] = [];
  for (const [channel, agg] of byChannel) {
    samples.push({
      task_id: task.id, target_id: target.id, metric: "error_count",
      dim_channel: String(channel), value: agg.count, checked_at: now,
      meta: { channel_name: agg.name ?? null, last_content: agg.lastContent ?? null, total: data?.total ?? items.length },
    });
  }
  return samples;
}
