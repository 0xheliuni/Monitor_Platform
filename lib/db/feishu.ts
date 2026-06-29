import "server-only";
import { getDb } from "./client";
import { newId, nowIso } from "./json";
import type { FeishuWebhookRow } from "../types/monitor";

export type WebhookInput = {
  name: string; webhook_url: string; secret: string | null; group_name: string | null;
};

const COLS = "id,name,webhook_url,secret,group_name,created_at,updated_at";

export async function listWebhooks(): Promise<FeishuWebhookRow[]> {
  return getDb().prepare(`SELECT ${COLS} FROM feishu_webhooks ORDER BY name ASC`).all() as FeishuWebhookRow[];
}

export async function getWebhook(id: string): Promise<FeishuWebhookRow | null> {
  return (getDb().prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE id = ?`).get(id) as FeishuWebhookRow | undefined) ?? null;
}

export async function createWebhook(input: WebhookInput): Promise<FeishuWebhookRow> {
  const id = newId();
  const now = nowIso();
  getDb().prepare(`INSERT INTO feishu_webhooks (${COLS}) VALUES (?,?,?,?,?,?,?)`)
    .run(id, input.name, input.webhook_url, input.secret, input.group_name, now, now);
  return (await getWebhook(id))!;
}

export async function updateWebhook(id: string, input: Partial<WebhookInput>): Promise<FeishuWebhookRow | null> {
  const db = getDb();
  if (!db.prepare("SELECT id FROM feishu_webhooks WHERE id = ?").get(id)) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.webhook_url !== undefined) { sets.push("webhook_url = ?"); params.push(input.webhook_url); }
  if ("secret" in input) { sets.push("secret = ?"); params.push(input.secret ?? null); }
  if ("group_name" in input) { sets.push("group_name = ?"); params.push(input.group_name ?? null); }
  params.push(id);
  db.prepare(`UPDATE feishu_webhooks SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getWebhook(id);
}

export async function deleteWebhook(id: string): Promise<void> {
  getDb().prepare("DELETE FROM feishu_webhooks WHERE id = ?").run(id);
}

export async function resolveWebhook(opts: { webhookId?: string | null; groupName?: string | null }): Promise<FeishuWebhookRow | null> {
  if (opts.webhookId) {
    const explicit = await getWebhook(opts.webhookId);
    if (explicit) return explicit;
  }
  const db = getDb();
  if (opts.groupName) {
    const byGroup = db.prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE group_name = ? LIMIT 1`).get(opts.groupName) as FeishuWebhookRow | undefined;
    if (byGroup) return byGroup;
  }
  const dft = db.prepare(`SELECT ${COLS} FROM feishu_webhooks WHERE group_name IS NULL LIMIT 1`).get() as FeishuWebhookRow | undefined;
  return dft ?? null;
}
