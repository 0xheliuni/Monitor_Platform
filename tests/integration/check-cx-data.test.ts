/**
 * Integration test: check-cx data-access modules using SQLite layer
 * Seeds an in-memory DB, injects via __setDbForTest, then exercises
 * the public exports of lib/database/* to verify they work end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";

const SCHEMA_PATH = resolve(process.cwd(), "lib/db/schema.sql");

function createSeededDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const now = new Date().toISOString();

  // Insert template with request_header JSON
  db.prepare(
    `INSERT INTO check_request_templates (id,name,type,request_header,metadata,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    "tpl1",
    "OpenAI Default",
    "openai",
    JSON.stringify({ "X-Custom-Header": "test-value" }),
    JSON.stringify({ timeout: 30 }),
    now,
    now
  );

  // Insert model linked to template
  db.prepare(
    `INSERT INTO check_models (id,type,model,template_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?)`
  ).run("m1", "openai", "gpt-4o-mini", "tpl1", now, now);

  // Insert enabled config
  db.prepare(
    `INSERT INTO check_configs (id,name,type,model_id,endpoint,api_key,enabled,is_maintenance,group_name,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "cfg1",
    "Test Provider",
    "openai",
    "m1",
    "https://api.openai.com/v1/chat/completions",
    "sk-test-key",
    1,
    0,
    "TestGroup",
    now,
    now
  );

  // Insert two history rows
  const h1 = new Date(Date.now() - 60000).toISOString();
  const h2 = new Date(Date.now() - 30000).toISOString();

  db.prepare(
    `INSERT INTO check_history (config_id,status,latency_ms,ping_latency_ms,checked_at,message,created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("cfg1", "operational", 120, 5.5, h1, null, now);

  db.prepare(
    `INSERT INTO check_history (config_id,status,latency_ms,ping_latency_ms,checked_at,message,created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run("cfg1", "degraded", 450, 8.2, h2, "slow response", now);

  return db;
}

beforeEach(() => {
  __setDbForTest(createSeededDb());
});

afterEach(() => {
  __setDbForTest(null);
});

describe("loadProviderConfigsFromDB", () => {
  it("returns 1 config with correct model name and request_header", async () => {
    // Dynamic import to pick up the injected DB
    const { loadProviderConfigsFromDB } = await import(
      "@/lib/database/config-loader"
    );

    const configs = await loadProviderConfigsFromDB({ forceRefresh: true });

    expect(configs).toHaveLength(1);

    const cfg = configs[0];
    expect(cfg.id).toBe("cfg1");
    expect(cfg.name).toBe("Test Provider");
    expect(cfg.type).toBe("openai");
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.apiKey).toBe("sk-test-key");
    expect(cfg.groupName).toBe("TestGroup");
    expect(cfg.is_maintenance).toBe(false);

    // request_header should be a parsed object, not a string
    expect(cfg.requestHeaders).toBeDefined();
    expect(typeof cfg.requestHeaders).toBe("object");
    expect(cfg.requestHeaders).not.toBeNull();
    expect((cfg.requestHeaders as Record<string, string>)["X-Custom-Header"]).toBe("test-value");
  });
});

describe("loadHistory", () => {
  it("returns snapshot with cfg1 containing 2 entries", async () => {
    const { loadHistory } = await import("@/lib/database/history");

    const snapshot = await loadHistory();

    expect(snapshot).toBeDefined();
    expect(Object.keys(snapshot)).toContain("cfg1");

    const entries = snapshot["cfg1"];
    expect(entries).toHaveLength(2);

    // Entries should be sorted descending by checkedAt
    const [first, second] = entries;
    expect(new Date(first.checkedAt).getTime()).toBeGreaterThan(
      new Date(second.checkedAt).getTime()
    );

    // Verify fields
    const operational = entries.find((e) => e.status === "operational");
    const degraded = entries.find((e) => e.status === "degraded");

    expect(operational).toBeDefined();
    expect(degraded).toBeDefined();
    expect(degraded?.message).toBe("slow response");

    // name/model/groupName should be populated from join
    expect(first.name).toBe("Test Provider");
    expect(first.model).toBe("gpt-4o-mini");
    expect(first.groupName).toBe("TestGroup");
  });
});
