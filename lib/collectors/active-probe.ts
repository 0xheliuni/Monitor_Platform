import "server-only";
import { checkWithAiSdk } from "../providers/ai-sdk-check";
import type { SampleInput } from "../db/samples";
import type { MonitorTargetRow, MonitorTaskRow } from "../types/monitor";
import type { ProviderConfig, ProviderType } from "../types/provider";

export async function collectProbe(
  target: MonitorTargetRow,
  task: MonitorTaskRow,
  now: string = new Date().toISOString()
): Promise<SampleInput[]> {
  if (!target.probe_api_key) throw new Error(`目标 ${target.name} 缺少 probe_api_key，无法实测`);
  const cfg = (task.config ?? {}) as { model?: string; format?: ProviderType; endpoint?: string };
  const model = cfg.model || "gpt-4o-mini";
  const providerConfig: ProviderConfig = {
    id: task.id,
    name: `${target.name}/${task.name}`,
    type: cfg.format || "openai",
    endpoint: cfg.endpoint || target.base_url,
    model,
    apiKey: target.probe_api_key,
    is_maintenance: false,
    groupName: target.group_name,
  };
  const result = await checkWithAiSdk(providerConfig);
  const reachable = result.status === "operational" || result.status === "degraded";
  const samples: SampleInput[] = [{
    task_id: task.id, target_id: target.id, metric: "reachable",
    dim_model: model, value: reachable ? 1 : 0, checked_at: now,
    meta: { status: result.status, message: result.message ?? null },
  }];
  if (typeof result.latencyMs === "number") {
    samples.push({ task_id: task.id, target_id: target.id, metric: "ttft_ms", dim_model: model, value: result.latencyMs, checked_at: now });
  }
  if (typeof result.pingLatencyMs === "number") {
    samples.push({ task_id: task.id, target_id: target.id, metric: "ping_ms", dim_model: model, value: result.pingLatencyMs, checked_at: now });
  }
  return samples;
}
