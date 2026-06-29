import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { insertSamples } from "@/lib/db/samples";
import { getTargetsOverview, getTargetDetail } from "@/lib/core/monitor-dashboard";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

describe("monitor-dashboard", () => {
  it("overview 含最新 reachable，且不泄露明文密钥", async () => {
    const t = await createTarget({
      name: "T", base_url: "http://x", kind: "self", admin_token: "acc-secret",
      admin_user_id: "1", probe_api_key: "sk-secret", group_name: "g", enabled: true,
    });
    await insertSamples([{ task_id: null, target_id: t.id, metric: "reachable", value: 1, checked_at: new Date().toISOString() }]);
    const ov = await getTargetsOverview();
    expect(ov[0].reachable).toBe(1);
    expect(JSON.stringify(ov)).not.toContain("acc-secret");
    expect(JSON.stringify(ov)).not.toContain("sk-secret");
  });

  it("getTargetDetail 不存在返回 null", async () => {
    expect(await getTargetDetail("nope")).toBeNull();
  });
});
