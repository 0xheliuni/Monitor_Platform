import pLimit from "p-limit";
import { nowIso } from "../db/json";
import { getDueTasks, recordTaskRun } from "../db/monitor-tasks";
import { getTarget } from "../db/targets";
import { insertSamples, cleanupSamples } from "../db/samples";
import { runCollector, SkipCollector } from "../collectors";
import { evaluateAlertRules } from "../alerting/engine";
import { getErrorMessage, logError } from "../utils";
import { getCheckConcurrency } from "./polling-config";

function retentionDays(): number {
  const raw = process.env.MONITOR_RETENTION_DAYS ?? process.env.HISTORY_RETENTION_DAYS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function runMonitorOnce(
  now: string = nowIso()
): Promise<{ ran: number; samples: number; fired: number; resolved: number }> {
  const tasks = await getDueTasks(now);
  const limit = pLimit(getCheckConcurrency());
  let sampleCount = 0;
  let ran = 0;

  await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => {
        const next = new Date(Date.parse(now) + task.interval_seconds * 1000).toISOString();
        try {
          const target = await getTarget(task.target_id);
          if (!target || !target.enabled) {
            await recordTaskRun(task.id, "skipped", "目标不存在或已禁用", next);
            return;
          }
          const samples = await runCollector(target, task);
          await insertSamples(samples);
          sampleCount += samples.length;
          ran++;
          await recordTaskRun(task.id, "ok", null, next);
        } catch (err) {
          if (err instanceof SkipCollector) {
            await recordTaskRun(task.id, "skipped", err.message, next);
            return;
          }
          logError(`监控任务 ${task.name} 采集失败`, err);
          await recordTaskRun(task.id, "failed", getErrorMessage(err), next);
        }
      })
    )
  );

  let fired = 0;
  let resolved = 0;
  try {
    const r = await evaluateAlertRules(now);
    fired = r.fired;
    resolved = r.resolved;
  } catch (err) {
    logError("告警评估失败", err);
  }

  if (sampleCount > 0) {
    try {
      await cleanupSamples(retentionDays());
    } catch (err) {
      logError("清理监控样本失败", err);
    }
  }

  return { ran, samples: sampleCount, fired, resolved };
}
