import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest, getDb } from "@/lib/db/client";
import { createWebhook, getWebhook, updateWebhook, resolveWebhook } from "@/lib/db/feishu";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
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

describe("feishu webhook secret 加密", () => {
  it("(a) 数据库中存储的是密文而非明文，读取返回明文", async () => {
    const plainSecret = "my-feishu-secret-xyz";
    const w = await createWebhook({
      name: "enc-test",
      webhook_url: "http://enc",
      secret: plainSecret,
      group_name: null,
    });
    // raw DB value must not equal plaintext
    const raw = getDb()
      .prepare("SELECT secret FROM feishu_webhooks WHERE id=?")
      .get(w.id) as { secret: string };
    expect(raw.secret).not.toBe(plainSecret);
    expect(raw.secret).toContain("."); // AES-GCM ciphertext format: iv.tag.data

    // getWebhook returns decrypted plaintext
    const got = await getWebhook(w.id);
    expect(got?.secret).toBe(plainSecret);

    // resolveWebhook also returns decrypted plaintext
    const resolved = await resolveWebhook({ webhookId: w.id });
    expect(resolved?.secret).toBe(plainSecret);
  });

  it("(b) secret=null 无加密，round-trip 返回 null", async () => {
    const w = await createWebhook({
      name: "no-secret",
      webhook_url: "http://nosec",
      secret: null,
      group_name: null,
    });
    const raw = getDb()
      .prepare("SELECT secret FROM feishu_webhooks WHERE id=?")
      .get(w.id) as { secret: string | null };
    expect(raw.secret).toBeNull();

    const got = await getWebhook(w.id);
    expect(got?.secret).toBeNull();

    const resolved = await resolveWebhook({ webhookId: w.id });
    expect(resolved?.secret).toBeNull();
  });

  it("(c) updateWebhook 更新 secret 后重新加密，round-trip 正常", async () => {
    const original = "original-secret";
    const updated = "updated-secret-456";
    const w = await createWebhook({
      name: "update-test",
      webhook_url: "http://upd",
      secret: original,
      group_name: null,
    });

    await updateWebhook(w.id, { secret: updated });

    // raw value must be ciphertext of new secret
    const raw = getDb()
      .prepare("SELECT secret FROM feishu_webhooks WHERE id=?")
      .get(w.id) as { secret: string };
    expect(raw.secret).not.toBe(updated);
    expect(raw.secret).not.toBe(original);
    expect(raw.secret).toContain(".");

    // getWebhook returns new plaintext
    const got = await getWebhook(w.id);
    expect(got?.secret).toBe(updated);
  });

  it("(c) updateWebhook 将 secret 设为 null 存 null，round-trip 返回 null", async () => {
    const w = await createWebhook({
      name: "null-update-test",
      webhook_url: "http://nullupd",
      secret: "some-secret",
      group_name: null,
    });

    await updateWebhook(w.id, { secret: null });

    const raw = getDb()
      .prepare("SELECT secret FROM feishu_webhooks WHERE id=?")
      .get(w.id) as { secret: string | null };
    expect(raw.secret).toBeNull();

    const got = await getWebhook(w.id);
    expect(got?.secret).toBeNull();
  });
});
