import { describe, it, expect, vi, afterEach } from "vitest";
import { collectBalance } from "@/lib/collectors/newapi-balance";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "balance", collector_type: "newapi_balance",
  config: null, interval_seconds: 600, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectBalance", () => {
  it("每渠道产出 channel_balance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { items: [
        { id: 7, name: "Azure", balance: 12.5, type: 1, status: 1 },
        { id: 9, name: "OpenAI", balance: 0.3, type: 1, status: 1 },
      ], total: 2 },
    }), { status: 200 })));
    const samples = await collectBalance(target, task, "2026-06-28T00:00:00.000Z");
    expect(samples).toHaveLength(2);
    const ch9 = samples.find((s) => s.dim_channel === "9");
    expect(ch9?.metric).toBe("channel_balance");
    expect(ch9?.value).toBe(0.3);
    expect(ch9?.meta).toMatchObject({ name: "OpenAI" });
  });
});
