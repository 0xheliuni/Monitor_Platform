import "server-only";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";
import type { SampleInput } from "../db/samples";
import { collectUsage } from "./newapi-usage";
import { collectErrors } from "./newapi-errors";
import { collectBalance } from "./newapi-balance";
import { collectCache } from "./newapi-cache";
import { collectProbe } from "./active-probe";

export class SkipCollector extends Error {}

export type CollectorFn = (target: MonitorTargetRow, task: MonitorTaskRow) => Promise<SampleInput[]>;

const REGISTRY: Record<string, CollectorFn> = {
  newapi_usage: collectUsage,
  newapi_errors: collectErrors,
  newapi_balance: collectBalance,
  newapi_cache: collectCache,
  active_probe: collectProbe,
};

export async function runCollector(target: MonitorTargetRow, task: MonitorTaskRow): Promise<SampleInput[]> {
  const fn = REGISTRY[task.collector_type];
  if (!fn) throw new Error(`未知采集器类型：${task.collector_type}`);
  if (task.collector_type !== "active_probe" && target.kind === "supplier") {
    throw new SkipCollector(`供应商目标仅支持 active_probe，跳过 ${task.collector_type}`);
  }
  return fn(target, task);
}
