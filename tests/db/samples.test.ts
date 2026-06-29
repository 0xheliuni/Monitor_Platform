import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { insertSamples, aggregateWindow, latestSamples, cleanupSamples } from "@/lib/db/samples";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("t1","T","http://x","self",now,now);
  __setDbForTest(db);
});

describe("samples", () => {
  it("批量写入并按 sum 聚合窗口", async () => {
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 3, checked_at: now },
      { task_id: null, target_id: "t1", metric: "error_count", value: 5, checked_at: now },
    ]);
    const sum = await aggregateWindow({
      targetId: "t1", metric: "error_count",
      sinceIso: new Date(Date.now() - 60_000).toISOString(), aggregation: "sum",
    });
    expect(sum).toBe(8);
  });

  it("avg/max/min/last 聚合", async () => {
    const t0 = new Date(Date.now() - 3000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 100, checked_at: t0 },
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 300, checked_at: t1 },
    ]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "avg" })).toBe(200);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "max" })).toBe(300);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "min" })).toBe(100);
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "last" })).toBe(300);
  });

  it("窗口外样本不计入；窗口内无样本返回 null", async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await insertSamples([{ task_id: null, target_id: "t1", metric: "ttft_ms", value: 999, checked_at: old }]);
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await aggregateWindow({ targetId: "t1", metric: "ttft_ms", sinceIso: since, aggregation: "avg" })).toBeNull();
  });

  it("meta 往返为对象，latestSamples 倒序", async () => {
    const t0 = new Date(Date.now() - 2000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "error_count", value: 1, checked_at: t0, meta: { sample: "a" } },
      { task_id: null, target_id: "t1", metric: "error_count", value: 2, checked_at: t1, meta: { sample: "b" } },
    ]);
    const latest = await latestSamples("t1", "error_count", 1);
    expect(latest[0].value).toBe(2);
    expect(latest[0].meta).toEqual({ sample: "b" });
  });

  it("cleanupSamples 删除过期样本", async () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    const fresh = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 1, checked_at: old },
      { task_id: null, target_id: "t1", metric: "ttft_ms", value: 2, checked_at: fresh },
    ]);
    const deleted = await cleanupSamples(30);
    expect(deleted).toBe(1);
    expect(await latestSamples("t1", "ttft_ms", 10)).toHaveLength(1);
  });
});
