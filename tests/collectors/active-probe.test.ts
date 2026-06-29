import { describe, it, expect, vi, afterEach } from "vitest";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@/lib/providers/ai-sdk-check", () => ({ checkWithAiSdk: checkMock }));

import { collectProbe } from "@/lib/collectors/active-probe";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "supplier",
  admin_token: null, admin_user_id: null, probe_api_key: "sk-probe", group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "probe", collector_type: "active_probe",
  config: { model: "gpt-4o-mini", format: "openai" }, interval_seconds: 60,
  enabled: true, is_maintenance: false, next_run_at: null, last_run_at: null,
  last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => { checkMock.mockReset(); });

describe("collectProbe", () => {
  it("operational → reachable=1，含 ttft/ping", async () => {
    checkMock.mockResolvedValue({ status: "operational", latencyMs: 250, pingLatencyMs: 30, model: "gpt-4o-mini" });
    const samples = await collectProbe(target, task, "2026-06-28T00:00:00.000Z");
    const m = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(m.reachable).toBe(1);
    expect(m.ttft_ms).toBe(250);
    expect(m.ping_ms).toBe(30);
    expect(samples[0].dim_model).toBe("gpt-4o-mini");
  });

  it("failed → reachable=0，不产出 ttft", async () => {
    checkMock.mockResolvedValue({ status: "failed", latencyMs: null, pingLatencyMs: null, model: "gpt-4o-mini" });
    const samples = await collectProbe(target, task, "2026-06-28T00:00:00.000Z");
    const m = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(m.reachable).toBe(0);
    expect(m.ttft_ms).toBeUndefined();
  });

  it("缺少 probe_api_key 抛错", async () => {
    await expect(collectProbe({ ...target, probe_api_key: null }, task, "2026-06-28T00:00:00.000Z")).rejects.toThrow(/probe/i);
  });
});
