import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTarget } from "@/lib/db/targets";
import { createTask, recordTaskRun } from "@/lib/db/monitor-tasks";
import { insertSamples } from "@/lib/db/samples";
import { getTargetsOverview, getTargetDetail, toPublicSample } from "@/lib/core/monitor-dashboard";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret";
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
});

describe("monitor-dashboard", () => {
  it("overview 含最新 reachable，且不泄露明文密钥", async () => {
    const t = await createTarget({
      name: "T", base_url: "http://x", kind: "self", admin_token: "acc-secret",
      admin_user_id: "1", probe_api_key: "sk-secret", group_name: "g", enabled: true,
    });
    await insertSamples([{ task_id: null, target_id: t.id, metric: "reachable", value: 1, checked_at: new Date().toISOString() }]);
    const ov = await getTargetsOverview();
    expect(ov[0].reachable).toBe(1);
    expect(JSON.stringify(ov)).not.toContain("acc-secret");
    expect(JSON.stringify(ov)).not.toContain("sk-secret");
  });

  it("getTargetDetail 不存在返回 null", async () => {
    expect(await getTargetDetail("nope")).toBeNull();
  });

  // FIX D: error_count must be summed across channels
  it("FIX D: getTargetsOverview error_count sums across all channels", async () => {
    const t = await createTarget({
      name: "D-target", base_url: "http://d", kind: "supplier", admin_token: "tok",
      admin_user_id: "1", probe_api_key: "sk-d", group_name: null, enabled: true,
    });
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: t.id, metric: "error_count", dim_channel: "7", value: 2, checked_at: now },
      { task_id: null, target_id: t.id, metric: "error_count", dim_channel: "9", value: 3, checked_at: now },
    ]);
    const ov = await getTargetsOverview();
    const entry = ov.find((o) => o.id === t.id);
    expect(entry).toBeDefined();
    expect(entry!.error_count).toBe(5);
  });

  it("FIX D: getTargetDetail metrics.error_count sums across all channels", async () => {
    const t = await createTarget({
      name: "D-detail", base_url: "http://d2", kind: "supplier", admin_token: "tok",
      admin_user_id: "1", probe_api_key: "sk-d2", group_name: null, enabled: true,
    });
    const now = new Date().toISOString();
    await insertSamples([
      { task_id: null, target_id: t.id, metric: "error_count", dim_channel: "7", value: 2, checked_at: now },
      { task_id: null, target_id: t.id, metric: "error_count", dim_channel: "9", value: 3, checked_at: now },
    ]);
    const detail = await getTargetDetail(t.id);
    expect(detail).not.toBeNull();
    expect(detail!.metrics.error_count).toBe(5);
  });

  // FIX C(i): toPublicSample strips meta
  it("FIX C(i): toPublicSample does not include meta field", async () => {
    const t = await createTarget({
      name: "C-target", base_url: "http://c", kind: "supplier", admin_token: "tok",
      admin_user_id: "1", probe_api_key: "sk-c", group_name: null, enabled: true,
    });
    const now = new Date().toISOString();
    await insertSamples([{
      task_id: null, target_id: t.id, metric: "error_count", dim_channel: "7", value: 1,
      checked_at: now, meta: { last_content: "secret error body", channel_name: "ch7" },
    }]);
    const { latestSamples } = await import("@/lib/db/samples");
    const rows = await latestSamples(t.id, "error_count", 1);
    const pub = toPublicSample(rows[0]);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("secret error body");
    expect(serialized).not.toContain("meta");
    expect(pub).toHaveProperty("metric");
    expect(pub).toHaveProperty("value");
    expect(pub).toHaveProperty("checked_at");
  });

  // FIX C(ii): getTargetDetail tasks replace last_error with has_error
  it("FIX C(ii): getTargetDetail task has has_error:true when last_status=failed", async () => {
    const t = await createTarget({
      name: "C2-target", base_url: "http://c2", kind: "supplier", admin_token: "tok",
      admin_user_id: "1", probe_api_key: "sk-c2", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: t.id, name: "err-task", collector_type: "newapi_errors",
      config: null, interval_seconds: 60, enabled: true, is_maintenance: false,
    });
    const nextRun = new Date(Date.now() + 60000).toISOString();
    await recordTaskRun(task.id, "failed", "internal stack trace ...", nextRun);

    const detail = await getTargetDetail(t.id);
    expect(detail).not.toBeNull();
    const pub = detail!.tasks.find((tk) => tk.id === task.id);
    expect(pub).toBeDefined();
    // must NOT leak last_error string
    expect(JSON.stringify(pub)).not.toContain("internal stack trace");
    expect("last_error" in pub!).toBe(false);
    expect(pub!.has_error).toBe(true);
  });

  it("FIX C(ii): getTargetDetail task has has_error:false when last_status=ok", async () => {
    const t = await createTarget({
      name: "C3-target", base_url: "http://c3", kind: "supplier", admin_token: "tok",
      admin_user_id: "1", probe_api_key: "sk-c3", group_name: null, enabled: true,
    });
    const task = await createTask({
      target_id: t.id, name: "ok-task", collector_type: "newapi_errors",
      config: null, interval_seconds: 60, enabled: true, is_maintenance: false,
    });
    const nextRun = new Date(Date.now() + 60000).toISOString();
    await recordTaskRun(task.id, "ok", null, nextRun);

    const detail = await getTargetDetail(t.id);
    const pub = detail!.tasks.find((tk) => tk.id === task.id);
    expect(pub).toBeDefined();
    expect("last_error" in pub!).toBe(false);
    expect(pub!.has_error).toBe(false);
  });
});
