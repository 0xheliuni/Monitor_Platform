import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { compare, evaluateAlertRules } from "@/lib/alerting/engine";
import { insertSamples } from "@/lib/db/samples";
import { getEventByRule } from "@/lib/db/alert-events";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerting/feishu-card", async (orig) => {
  const actual = await orig<typeof import("@/lib/alerting/feishu-card")>();
  return { ...actual, sendFeishu: (...a: unknown[]) => sendMock(...a) };
});

function seed() {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("t1","Prod A","http://x","self","生产",now,now);
  db.prepare("INSERT INTO feishu_webhooks (id,name,webhook_url,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("w1","default","http://hook",null,now,now);
  __setDbForTest(db);
  return db;
}

function addRule(db: Database.Database, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const r = {
    id: "r1", name: "错误激增", target_id: "t1", task_id: null, metric: "error_count",
    comparator: ">", threshold: 10, window_seconds: 300, aggregation: "sum",
    consecutive_breaches: 1, severity: "critical", feishu_webhook_id: null, enabled: 1, ...over,
  };
  db.prepare(`INSERT INTO alert_rules (id,name,target_id,task_id,metric,comparator,threshold,window_seconds,aggregation,consecutive_breaches,severity,feishu_webhook_id,enabled,created_at,updated_at)
    VALUES (@id,@name,@target_id,@task_id,@metric,@comparator,@threshold,@window_seconds,@aggregation,@consecutive_breaches,@severity,@feishu_webhook_id,@enabled,'${now}','${now}')`).run(r);
  return r.id;
}

let db: Database.Database;
beforeEach(() => { db = seed(); sendMock.mockReset(); sendMock.mockResolvedValue(undefined); });
afterEach(() => vi.restoreAllMocks());

describe("compare", () => {
  it("各比较算子", () => {
    expect(compare(5, ">", 3)).toBe(true);
    expect(compare(2, "<", 3)).toBe(true);
    expect(compare(3, ">=", 3)).toBe(true);
    expect(compare(3, "==", 3)).toBe(true);
    expect(compare(2, ">", 3)).toBe(false);
  });
});

describe("evaluateAlertRules 状态机", () => {
  it("超阈值且 consecutive=1 → firing 并发一次飞书", async () => {
    addRule(db);
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 8, checked_at: now },
      { task_id: null, target_id: "t1", metric: "error_count", value: 7, checked_at: now },
    ]);
    const res = await evaluateAlertRules(now);
    expect(res.fired).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await getEventByRule("r1"))?.state).toBe("firing");
  });

  it("firing 后再次超阈值不重发（去重）", async () => {
    addRule(db);
    const now = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: now }]);
    await evaluateAlertRules(now);
    sendMock.mockClear();
    await evaluateAlertRules(new Date().toISOString());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("恢复时发 resolved 卡片", async () => {
    addRule(db);
    const t1 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t1 }]);
    await evaluateAlertRules(t1);
    sendMock.mockClear();
    // 之后窗口无新样本 → not breached → resolved
    const later = new Date(Date.now() + 400_000).toISOString();
    const res = await evaluateAlertRules(later);
    expect(res.resolved).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await getEventByRule("r1"))?.state).toBe("resolved");
  });

  it("consecutive_breaches=2：首轮只累积不发，次轮才 firing", async () => {
    addRule(db, { consecutive_breaches: 2 });
    const t1 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t1 }]);
    const r1 = await evaluateAlertRules(t1);
    expect(r1.fired).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
    const t2 = new Date().toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "error_count", value: 50, checked_at: t2 }]);
    const r2 = await evaluateAlertRules(t2);
    expect(r2.fired).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
