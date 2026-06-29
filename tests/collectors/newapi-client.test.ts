import { describe, it, expect, vi, afterEach } from "vitest";
import { newapiGet, unixToIso, isoToUnix } from "@/lib/collectors/newapi-client";
import type { MonitorTargetRow } from "@/lib/types/monitor";

const target: MonitorTargetRow = {
  id: "t1", name: "T", base_url: "https://api.example.com", kind: "self",
  admin_token: "acc-1", admin_user_id: "1", probe_api_key: null, group_name: null,
  enabled: true, created_at: "", updated_at: "",
};

afterEach(() => vi.restoreAllMocks());

describe("newapi-client", () => {
  it("注入鉴权头并解析 data 信封", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: 1 } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const data = await newapiGet(target, "/api/data", { start_timestamp: 100 });
    expect(data).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://api.example.com/api/data?start_timestamp=100");
    expect((init.headers as Record<string,string>)["Authorization"]).toBe("acc-1");
    expect((init.headers as Record<string,string>)["New-Api-User"]).toBe("1");
  });

  it("success=false 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: "无权限" }), { status: 200 })
    ));
    await expect(newapiGet(target, "/api/data")).rejects.toThrow("无权限");
  });

  it("HTTP 非 2xx 抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(newapiGet(target, "/api/data")).rejects.toThrow(/500/);
  });

  it("时间戳转换", () => {
    expect(unixToIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoToUnix("1970-01-01T00:00:10.000Z")).toBe(10);
  });
});
