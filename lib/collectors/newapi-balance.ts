import "server-only";
import { newapiGet } from "./newapi-client";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";

type ChannelItem = { id: number; name?: string; balance?: number; type?: number; status?: number };

export async function collectBalance(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  const data = (await newapiGet(target, "/api/channel/", { p: 1, page_size: 100 })) as
    { items?: ChannelItem[] } | null;
  const items = data?.items ?? [];
  return items.map((c) => ({
    task_id: task.id, target_id: target.id, metric: "channel_balance" as const,
    dim_channel: String(c.id), value: typeof c.balance === "number" ? c.balance : 0,
    checked_at: now, meta: { name: c.name ?? null, status: c.status ?? null, type: c.type ?? null },
  }));
}
