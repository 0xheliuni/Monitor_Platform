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

describe("schema", () => {
  it("创建全部 6 张表", () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("check_configs");
    expect(names).toContain("check_models");
    expect(names).toContain("check_request_templates");
    expect(names).toContain("check_history");
    expect(names).toContain("group_info");
    expect(names).toContain("system_notifications");
    expect(names).not.toContain("check_poller_leases");
  });

  it("外键级联：删 config 连带删 history", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO check_request_templates (id,name,type,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("t1", "tpl", "openai", now, now);
    db.prepare("INSERT INTO check_models (id,type,model,template_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("m1", "openai", "gpt", "t1", now, now);
    db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("c1", "cfg", "openai", "m1", "http://x", "k", now, now);
    db.prepare("INSERT INTO check_history (config_id,status,checked_at,created_at) VALUES (?,?,?,?)")
      .run("c1", "operational", now, now);
    db.prepare("DELETE FROM check_configs WHERE id=?").run("c1");
    const count = db.prepare("SELECT COUNT(*) AS n FROM check_history").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
