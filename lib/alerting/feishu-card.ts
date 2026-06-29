import "server-only";
import { createHmac } from "node:crypto";
import type { AlertSeverity, AlertState, FeishuWebhookRow } from "../types/monitor";

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  info: "blue", warning: "orange", critical: "red",
};

export type AlertCardPayload = {
  state: AlertState;
  severity: AlertSeverity;
  ruleName: string;
  targetName: string;
  metric: string;
  currentValue: number;
  comparator: string;
  threshold: number;
  windowSeconds: number;
  firstSeenAt: string | null;
  link?: string;
};

export function buildAlertCard(p: AlertCardPayload): object {
  const color = p.state === "resolved" ? "green" : SEVERITY_COLOR[p.severity];
  const title = p.state === "resolved"
    ? `✅ 已恢复：${p.ruleName}`
    : `🚨 告警：${p.ruleName}（${p.severity}）`;
  const lines = [
    `**目标**：${p.targetName}`,
    `**指标**：${p.metric}`,
    `**当前值**：${p.currentValue}（阈值 ${p.comparator} ${p.threshold}，窗口 ${p.windowSeconds}s）`,
    p.firstSeenAt ? `**首次发生**：${p.firstSeenAt}` : null,
    p.link ? `[查看详情](${p.link})` : null,
  ].filter(Boolean);
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: color, title: { tag: "plain_text", content: title } },
      elements: [{ tag: "div", text: { tag: "lark_md", content: lines.join("\n") } }],
    },
  };
}

export function signFeishu(secret: string, timestampSec: number): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

export async function sendFeishu(webhook: FeishuWebhookRow, card: object): Promise<void> {
  const body: Record<string, unknown> = { ...card };
  if (webhook.secret) {
    const ts = Math.floor(Date.now() / 1000);
    body.timestamp = String(ts);
    body.sign = signFeishu(webhook.secret, ts);
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(webhook.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`飞书 webhook HTTP ${res.status}`);
      // Feishu returns HTTP 200 even on logical failures (e.g. bad signature).
      // Treat any numeric nonzero `code` as a failure so retries trigger.
      try {
        const text = await res.text();
        const json = JSON.parse(text) as Record<string, unknown>;
        if (typeof json.code === "number" && json.code !== 0) {
          throw new Error(`飞书 webhook 逻辑错误 code=${json.code} msg=${json.msg ?? ""}`);
        }
      } catch (parseErr) {
        // If the thrown error is our own logical-failure error, re-throw it.
        if (parseErr instanceof Error && parseErr.message.startsWith("飞书 webhook 逻辑错误")) {
          throw parseErr;
        }
        // Non-JSON or unparseable body on HTTP 200 → treat as success (stay compatible).
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("飞书发送失败");
}
