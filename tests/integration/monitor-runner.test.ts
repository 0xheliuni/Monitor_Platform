import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest, getDb } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { createTask, getTask } from "@/lib/db/monitor-tasks";
import { latestSamples } from "@/lib/db/samples";
import { newId, nowIso } from "@/lib/db/json";

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

  it("坏目标（加密字段损坏）导致 getTarget 抛出时，不影响其他任务完成采集", async () => {
    // task A: 直接向 DB 插入一个 probe_api_key 为无效密文的目标，getTarget 读取时必然抛出
    checkMock.mockResolvedValue({ status: "operational", latencyMs: 150, pingLatencyMs: 15, model: "gpt-4o-mini" });
    const db = getDb();
    const insertTime = nowIso();
    const badTargetId = newId();
    db.prepare(
      `INSERT INTO monitor_targets (id, name, base_url, kind, admin_token, admin_user_id, probe_api_key, group_name, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(badTargetId, "坏目标", "https://bad.example.com", "supplier", null, null, "not-valid-ciphertext", null, 1, insertTime, insertTime);

    const taskAId = newId();
    // next_run_at set to insertTime so it is due when we pass a later timestamp
    db.prepare(
      `INSERT INTO monitor_tasks (id, target_id, name, collector_type, config, interval_seconds, enabled, is_maintenance, next_run_at, last_run_at, last_status, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskAId, badTargetId, "probe-bad", "active_probe", JSON.stringify({ model: "gpt-4o-mini" }), 60, 1, 0, insertTime, null, null, null, insertTime, insertTime);

    // task B: 正常目标 + active_probe 任务
    const goodTarget = await createTarget({
      name: "好目标", base_url: "https://good.example.com", kind: "supplier",
      admin_token: null, admin_user_id: null, probe_api_key: "sk-good", group_name: null, enabled: true,
    });
    const taskB = await createTask({
      target_id: goodTarget.id, name: "probe-good", collector_type: "active_probe",
      config: { model: "gpt-4o-mini" }, interval_seconds: 60, enabled: true, is_maintenance: false,
    });

    // Use a timestamp after both tasks' next_run_at so both are due
    const runNow = new Date(Date.now() + 2000).toISOString();

    // 当前实现中 getTarget 抛出会导致 Promise.all reject，runMonitorOnce 也会 reject
    // 本测试预期修复后：函数正常返回，task B 完成采集，task A 被标记 failed
    const res = await runMonitorOnce(runNow);

    // 整个 tick 必须正常返回，不能 reject
    expect(res).toBeDefined();
    expect(res).toHaveProperty("ran");
    expect(res).toHaveProperty("fired");

    // task B 必须正常完成
    expect(res.ran).toBeGreaterThanOrEqual(1);
    const afterB = await getTask(taskB.id);
    expect(afterB?.last_status).toBe("ok");

    // task A 必须被记录为 failed（而非让整个 tick 崩溃）
    const afterA = db.prepare("SELECT last_status, next_run_at FROM monitor_tasks WHERE id = ?").get(taskAId) as
      { last_status: string | null; next_run_at: string | null } | undefined;
    expect(afterA?.last_status).toBe("failed");
    // next_run_at 必须被设置（任务能重新调度，不会紧循环或永久卡住）
    expect(afterA?.next_run_at).toBeTruthy();
  });
});
