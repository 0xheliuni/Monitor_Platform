import { describe, it, expect, vi, afterEach } from "vitest";
import { collectErrors } from "@/lib/collectors/newapi-errors";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "errors", collector_type: "newapi_errors",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectErrors", () => {
  it("按 channel 聚合 error_count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [
        { channel: 7, channel_name: "Azure", model_name: "gpt-4o", created_at: 1700000000, content: "500 err" },
        { channel: 7, channel_name: "Azure", model_name: "gpt-4o", created_at: 1700000001, content: "timeout" },
        { channel: 9, channel_name: "OpenAI", model_name: "gpt-4o", created_at: 1700000002, content: "401" },
      ], total: 3 },
    }), { status: 200 })));
    const samples = await collectErrors(target, task, "2026-06-28T00:00:00.000Z");
    const ch7 = samples.find((s) => s.dim_channel === "7");
    const ch9 = samples.find((s) => s.dim_channel === "9");
    expect(ch7?.metric).toBe("error_count");
    expect(ch7?.value).toBe(2);
    expect(ch9?.value).toBe(1);
  });

  it("无错误返回空数组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [], total: 0 } }), { status: 200 })));
    expect(await collectErrors(target, task, "2026-06-28T00:00:00.000Z")).toHaveLength(0);
  });
});
