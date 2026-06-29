import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { getEventByRule, upsertEvent } from "@/lib/db/alert-events";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO feishu_webhooks (id,name,webhook_url,created_at,updated_at) VALUES (?,?,?,?,?)").run("w1","W","http://w",now,now);
  db.prepare(`INSERT INTO alert_rules (id,name,metric,comparator,threshold,window_seconds,aggregation,severity,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run("r1","R","error_count",">",10,300,"sum","warning",now,now);
  __setDbForTest(db);
});

describe("alert-events 状态机存储", () => {
  it("首次 upsert 创建事件，再次 upsert 更新同一行", async () => {
    expect(await getEventByRule("r1")).toBeNull();
    const now = new Date().toISOString();
    const e1 = await upsertEvent("r1", { state: "firing", breach_count: 1, first_seen_at: now, last_seen_at: now, message: "x" });
    expect(e1.state).toBe("firing");
    const e2 = await upsertEvent("r1", { state: "resolved", breach_count: 0, resolved_at: now });
    expect(e2.id).toBe(e1.id);
    expect(e2.state).toBe("resolved");
    const all = (await getEventByRule("r1"));
    expect(all?.state).toBe("resolved");
  });
});
