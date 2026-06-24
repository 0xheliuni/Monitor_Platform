import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { insertHistory } from "@/lib/db/history";
import { getAvailabilityStats } from "@/lib/db/availability";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO check_models (id,type,model,created_at,updated_at) VALUES (?,?,?,?,?)").run("m1","openai","gpt",now,now);
  db.prepare("INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("c1","C","openai","m1","http://x","k",now,now);
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("availability", () => {
  it("degraded 计入可用", async () => {
    const fresh = new Date().toISOString();
    await insertHistory([
      { config_id: "c1", status: "operational", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "degraded", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
      { config_id: "c1", status: "failed", latency_ms: 1, ping_latency_ms: null, checked_at: fresh, message: null },
    ]);
    const rows = await getAvailabilityStats(["c1"]);
    const d7 = rows.find((r) => r.period === "7d");
    expect(d7?.total_checks).toBe(3);
    expect(d7?.operational_count).toBe(2);
    expect(d7?.availability_pct).toBeCloseTo(66.67, 1);
  });
});
