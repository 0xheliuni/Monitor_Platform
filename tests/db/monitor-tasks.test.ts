import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTask, getTask, getDueTasks, recordTaskRun } from "@/lib/db/monitor-tasks";

beforeEach(() => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO monitor_targets (id,name,base_url,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("t1","T","http://x","self",now,now);
  __setDbForTest(db);
});

const base = {
  target_id: "t1", name: "用量采集", collector_type: "newapi_usage" as const,
  config: { window: 300 }, interval_seconds: 300, enabled: true, is_maintenance: false,
};

describe("monitor-tasks", () => {
  it("创建时 next_run_at 立即到期，config 往返为对象", async () => {
    const k = await createTask(base);
    expect(k.config).toEqual({ window: 300 });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).toContain(k.id);
  });

  it("recordTaskRun 顺延 next_run_at 后不再到期", async () => {
    const k = await createTask(base);
    const future = new Date(Date.now() + 300_000).toISOString();
    await recordTaskRun(k.id, "ok", null, future);
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
    const got = await getTask(k.id);
    expect(got?.last_status).toBe("ok");
    expect(got?.next_run_at).toBe(future);
  });

  it("维护中的任务不到期", async () => {
    const k = await createTask({ ...base, is_maintenance: true });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
  });

  it("禁用的任务不到期", async () => {
    const k = await createTask({ ...base, enabled: false });
    const due = await getDueTasks(new Date().toISOString());
    expect(due.map((d) => d.id)).not.toContain(k.id);
  });

  it("recordTaskRun 记录失败原因", async () => {
    const k = await createTask(base);
    await recordTaskRun(k.id, "failed", "连接超时", new Date().toISOString());
    const got = await getTask(k.id);
    expect(got?.last_status).toBe("failed");
    expect(got?.last_error).toBe("连接超时");
  });
});
