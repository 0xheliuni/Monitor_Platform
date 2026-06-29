import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  return db;
}

describe("monitor schema", () => {
  it("创建全部 6 张监控表", () => {
    const db = freshDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["monitor_targets","monitor_tasks","metric_samples","feishu_webhooks","alert_rules","alert_events"]) {
      expect(names).toContain(t);
    }
  });

  it("外键级联：删除 target 连带删除其 task", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("t1","T","http://x","self",now,now);
    db.prepare("INSERT INTO monitor_tasks (id,target_id,name,collector_type,interval_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("k1","t1","K","active_probe",60,now,now);
    db.prepare("DELETE FROM monitor_targets WHERE id=?").run("t1");
    const count = db.prepare("SELECT COUNT(*) c FROM monitor_tasks").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("collector_type CHECK 约束拒绝非法值", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("t1","T","http://x","self",now,now);
    expect(() =>
      db.prepare("INSERT INTO monitor_tasks (id,target_id,name,collector_type,interval_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run("k1","t1","K","bogus",60,now,now)
    ).toThrow();
  });
});
