import "server-only";
import { nowIso } from "../db/json";
import { listEnabledRules } from "../db/alert-rules";
import { aggregateWindow } from "../db/samples";
import { getEventByRule, upsertEvent } from "../db/alert-events";
import { getTarget } from "../db/targets";
import { resolveWebhook } from "../db/feishu";
import { buildAlertCard, sendFeishu } from "./feishu-card";
import { logError } from "../utils";
import type { AlertRuleRow, Comparator } from "../types/monitor";

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    case "==": return value === threshold;
    default: return false;
  }
}

async function notify(rule: AlertRuleRow, state: "firing" | "resolved", value: number, firstSeenAt: string | null): Promise<boolean> {
  const target = rule.target_id ? await getTarget(rule.target_id) : null;
  const webhook = await resolveWebhook({ webhookId: rule.feishu_webhook_id, groupName: target?.group_name ?? null });
  if (!webhook) {
    logError(`告警规则 ${rule.name} 无可用飞书 webhook`, new Error("no webhook"));
    return false;
  }
  const card = buildAlertCard({
    state, severity: rule.severity, ruleName: rule.name, targetName: target?.name ?? "全局",
    metric: rule.metric, currentValue: value, comparator: rule.comparator, threshold: rule.threshold,
    windowSeconds: rule.window_seconds, firstSeenAt,
  });
  try {
    await sendFeishu(webhook, card);
    return true;
  } catch (err) {
    logError(`告警规则 ${rule.name} 飞书发送失败`, err);
    return false;
  }
}

export async function evaluateAlertRules(now: string = nowIso()): Promise<{ fired: number; resolved: number }> {
  const rules = await listEnabledRules();
  let fired = 0;
  let resolved = 0;
  for (const rule of rules) {
    try {
      const since = new Date(Date.parse(now) - rule.window_seconds * 1000).toISOString();
      const value = await aggregateWindow({
        targetId: rule.target_id, taskId: rule.task_id, metric: rule.metric,
        sinceIso: since, aggregation: rule.aggregation,
      });
      const breached = value !== null && compare(value, rule.comparator, rule.threshold);
      const event = await getEventByRule(rule.id);
      const isFiring = event?.state === "firing";

      if (breached && !isFiring) {
        const nextCount = (event?.breach_count ?? 0) + 1;
        if (nextCount >= rule.consecutive_breaches) {
          const firstSeen = event?.first_seen_at ?? now;
          const sent = await notify(rule, "firing", value!, firstSeen);
          await upsertEvent(rule.id, {
            state: "firing", breach_count: nextCount, first_seen_at: firstSeen,
            last_seen_at: now, resolved_at: null,
            last_notified_at: sent ? now : (event?.last_notified_at ?? null),
            message: `${rule.metric}=${value} ${rule.comparator} ${rule.threshold}`,
          });
          fired++;
        } else {
          await upsertEvent(rule.id, { state: "resolved", breach_count: nextCount, first_seen_at: event?.first_seen_at ?? now, last_seen_at: now });
        }
      } else if (breached && isFiring) {
        await upsertEvent(rule.id, { last_seen_at: now });
      } else if (!breached && isFiring) {
        await notify(rule, "resolved", value ?? 0, event?.first_seen_at ?? null);
        await upsertEvent(rule.id, { state: "resolved", breach_count: 0, resolved_at: now, last_seen_at: now });
        resolved++;
      } else if (!breached && event && event.breach_count > 0) {
        await upsertEvent(rule.id, { breach_count: 0 });
      }
    } catch (err) {
      logError(`评估告警规则 ${rule.name} 失败`, err);
    }
  }
  return { fired, resolved };
}
