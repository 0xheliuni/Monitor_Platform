import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { createTask, getTask } from "@/lib/db/monitor-tasks";
import { latestSamples } from "@/lib/db/samples";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@/lib/providers/ai-sdk-check", () => ({ checkWithAiSdk: checkMock }));

import { runMonitorOnce } from "@/lib/core/monitor-runner";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
  checkMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("runMonitorOnce", () => {
  it("执行到期的 active_probe 任务并写样本、顺延调度", async () => {
    checkMock.mockResolvedValue({ status: "operational", latencyMs: 200, pingLatencyMs: 20, model: "gpt-4o-mini" });
    const target = await createTarget({
      name: "供应商", base_url: "https://s.example.com", kind: "supplier",
      admin_token: null, admin_user_id: null, probe_api_key: "sk-x", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: target.id, name: "probe", collector_type: "active_probe",
      config: { model: "gpt-4o-mini" }, interval_seconds: 60, enabled: true, is_maintenance: false,
    });
    const res = await runMonitorOnce(new Date().toISOString());
    expect(res.ran).toBe(1);
    expect(res.samples).toBeGreaterThanOrEqual(1);
    const reach = await latestSamples(target.id, "reachable", 1);
    expect(reach[0].value).toBe(1);
    const after = await getTask(task.id);
    expect(after?.last_status).toBe("ok");
    expect(Date.parse(after!.next_run_at!)).toBeGreaterThan(Date.now());
  });

  it("供应商目标的 newapi_usage 任务被标记 skipped", async () => {
    const target = await createTarget({
      name: "供应商", base_url: "https://s.example.com", kind: "supplier",
      admin_token: null, admin_user_id: null, probe_api_key: "sk-x", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: target.id, name: "usage", collector_type: "newapi_usage",
      config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
    });
    await runMonitorOnce(new Date().toISOString());
    expect((await getTask(task.id))?.last_status).toBe("skipped");
  });
});
