import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createWebhook, resolveWebhook } from "@/lib/db/feishu";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

describe("feishu webhook 路由", () => {
  it("优先用显式 webhookId", async () => {
    const w = await createWebhook({ name: "A", webhook_url: "http://a", secret: null, group_name: "g1" });
    await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: w.id, groupName: "g1" });
    expect(r?.id).toBe(w.id);
  });

  it("无显式 id 时按 group_name 匹配", async () => {
    const g = await createWebhook({ name: "G", webhook_url: "http://g", secret: null, group_name: "生产" });
    await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: null, groupName: "生产" });
    expect(r?.id).toBe(g.id);
  });

  it("group 无匹配时回退到默认（group_name 为 NULL）", async () => {
    const d = await createWebhook({ name: "default", webhook_url: "http://d", secret: null, group_name: null });
    const r = await resolveWebhook({ webhookId: null, groupName: "未知" });
    expect(r?.id).toBe(d.id);
  });

  it("既无匹配也无默认时返回 null", async () => {
    await createWebhook({ name: "G", webhook_url: "http://g", secret: null, group_name: "生产" });
    const r = await resolveWebhook({ webhookId: null, groupName: "未知" });
    expect(r).toBeNull();
  });
});
