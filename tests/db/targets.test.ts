import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest, getDb } from "@/lib/db/client";
import { createTarget, getTarget, listTargets, updateTarget, deleteTarget } from "@/lib/db/targets";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

const base = {
  name: "Prod A", base_url: "https://a.example.com", kind: "self" as const,
  admin_token: "acc-token-xyz", admin_user_id: "1", probe_api_key: "sk-probe-123",
  group_name: "生产", enabled: true,
};

describe("targets", () => {
  it("创建后读取返回解密明文", async () => {
    const t = await createTarget(base);
    const got = await getTarget(t.id);
    expect(got?.admin_token).toBe("acc-token-xyz");
    expect(got?.probe_api_key).toBe("sk-probe-123");
  });

  it("数据库中存储的是密文而非明文", async () => {
    const t = await createTarget(base);
    const raw = getDb().prepare("SELECT admin_token, probe_api_key FROM monitor_targets WHERE id=?").get(t.id) as any;
    expect(raw.admin_token).not.toBe("acc-token-xyz");
    expect(raw.admin_token).toContain(".");
  });

  it("供应商目标 token 为 null 不报错", async () => {
    const t = await createTarget({ ...base, kind: "supplier", admin_token: null, admin_user_id: null });
    const got = await getTarget(t.id);
    expect(got?.admin_token).toBeNull();
    expect(got?.probe_api_key).toBe("sk-probe-123");
  });

  it("更新 base_url 不影响未变更的密文字段", async () => {
    const t = await createTarget(base);
    await updateTarget(t.id, { base_url: "https://b.example.com" });
    const got = await getTarget(t.id);
    expect(got?.base_url).toBe("https://b.example.com");
    expect(got?.admin_token).toBe("acc-token-xyz");
  });

  it("删除后查不到", async () => {
    const t = await createTarget(base);
    await deleteTarget(t.id);
    expect(await getTarget(t.id)).toBeNull();
    expect(await listTargets()).toHaveLength(0);
  });
});
