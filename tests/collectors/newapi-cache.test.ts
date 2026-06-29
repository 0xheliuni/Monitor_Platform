import { describe, it, expect, vi, afterEach } from "vitest";
import { collectCache } from "@/lib/collectors/newapi-cache";
import type { MonitorTargetRow, MonitorTaskRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};
const task: MonitorTaskRow = {
  id: "k1", target_id: "t1", name: "cache", collector_type: "newapi_cache",
  config: null, interval_seconds: 300, enabled: true, is_maintenance: false,
  next_run_at: null, last_run_at: null, last_status: null, last_error: null, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("collectCache", () => {
  it("产出 cache_entries（value=Total），meta 含 ByRuleName", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { Enabled: true, Total: 42, Unknown: 3, ByRuleName: { ruleA: 40, ruleB: 2 } },
    }), { status: 200 })));
    const samples = await collectCache(target, task, "2026-06-28T00:00:00.000Z");
    expect(samples).toHaveLength(1);
    expect(samples[0].metric).toBe("cache_entries");
    expect(samples[0].value).toBe(42);
    expect(samples[0].meta).toMatchObject({ ByRuleName: { ruleA: 40, ruleB: 2 }, Unknown: 3 });
  });
});
