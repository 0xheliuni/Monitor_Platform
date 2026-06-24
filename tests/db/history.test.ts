import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import {
  insertHistory,
  getRecentCheckHistory,
  pruneCheckHistory,
  getCheckHistoryByTime,
} from "@/lib/db/history";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("m1", "openai", "gpt-4o", now, now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("c1", "Cfg1", "openai", "m1", "http://x", "k", "G1", now, now);
  __setDbForTest(db);
  return db;
}

beforeEach(() => seed());

describe("history", () => {
  it("insert 后 getRecentCheckHistory 带 join 字段", async () => {
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 100, ping_latency_ms: 5, checked_at: "2026-06-24T10:00:00.000Z", message: null },
      { config_id: "c1", status: "degraded", latency_ms: 200, ping_latency_ms: 6, checked_at: "2026-06-24T11:00:00.000Z", message: "slow" },
    ]);
    const rows = await getRecentCheckHistory(60, null);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Cfg1");
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].group_name).toBe("G1");
    // DESC：最新在前
    expect(rows[0].checked_at).toBe("2026-06-24T11:00:00.000Z");
  });

  it("limitPerConfig 限制每个 config 条数", async () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: `2026-06-24T1${i}:00:00.000Z`, message: null,
    }));
    await insertHistory(recs);
    const rows = await getRecentCheckHistory(3, ["c1"]);
    expect(rows.length).toBe(3);
  });

  it("prune 删除超期记录，返回删除数", async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: old, message: null },
      { config_id: "c1", status: "operational", latency_ms: 2, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const deleted = await pruneCheckHistory(30);
    expect(deleted).toBe(1);
  });

  it("getCheckHistoryByTime 采样保留首尾且不超过上限", async () => {
    const base = Date.now();
    const recs = Array.from({ length: 100 }, (_, i) => ({
      config_id: "c1", status: "operational", latency_ms: i, ping_latency_ms: null,
      checked_at: new Date(base - (100 - i) * 1000).toISOString(), message: null,
    }));
    await insertHistory(recs);
    const rows = await getCheckHistoryByTime(3600_000, ["c1"], 10);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(1);

    // Assert first and last inserted records are preserved
    const sorted = [...recs].sort((a, b) => a.checked_at.localeCompare(b.checked_at));
    expect(rows.some(r => r.checked_at === sorted[0].checked_at)).toBe(true);
    expect(rows.some(r => r.checked_at === sorted[sorted.length - 1].checked_at)).toBe(true);
  });
});
