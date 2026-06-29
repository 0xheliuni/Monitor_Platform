import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createRule, getRule, listEnabledRules, updateRule } from "@/lib/db/alert-rules";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

const base = {
  name: "错误激增", target_id: null, task_id: null, metric: "error_count" as const,
  comparator: ">" as const, threshold: 20, window_seconds: 300, aggregation: "sum" as const,
  consecutive_breaches: 2, severity: "critical" as const, feishu_webhook_id: null, enabled: true,
};

describe("alert-rules", () => {
  it("创建并读取", async () => {
    const r = await createRule(base);
    const got = await getRule(r.id);
    expect(got?.threshold).toBe(20);
    expect(got?.consecutive_breaches).toBe(2);
  });

  it("listEnabledRules 只返回启用的", async () => {
    await createRule(base);
    await createRule({ ...base, name: "禁用规则", enabled: false });
    const enabled = await listEnabledRules();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("错误激增");
  });

  it("更新阈值", async () => {
    const r = await createRule(base);
    await updateRule(r.id, { threshold: 50 });
    expect((await getRule(r.id))?.threshold).toBe(50);
  });
});
