import { describe, it, expect, vi, afterEach } from "vitest";
import { collectUsage } from "@/lib/collectors/newapi-usage";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "usage", collector_type: "newapi_usage",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null,
  created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectUsage", () => {
  it("每条 QuotaData 产出 quota/tokens/count 三个 sample", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [
        { model_name: "gpt-4o", username: "alice", created_at: 1700000000, token_used: 1200, count: 5, quota: 800 },
      ],
    }), { status: 200 })));
    const now = "2026-06-28T00:00:00.000Z";
    const samples = await collectUsage(target, task, now);
    expect(samples).toHaveLength(3);
    const byMetric = Object.fromEntries(samples.map((s) => [s.metric, s.value]));
    expect(byMetric.usage_quota).toBe(800);
    expect(byMetric.usage_tokens).toBe(1200);
    expect(byMetric.request_count).toBe(5);
    expect(samples[0].dim_model).toBe("gpt-4o");
    expect(samples[0].dim_user).toBe("alice");
    expect(samples[0].checked_at).toBe(now);
  });

  it("空数据返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })));
    expect(await collectUsage(target, task, "2026-06-28T00:00:00.000Z")).toHaveLength(0);
  });
});
