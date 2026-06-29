import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAlertCard, signFeishu, sendFeishu } from "@/lib/alerting/feishu-card";
import type { FeishuWebhookRow } from "@/lib/types/monitor";

afterEach(() => vi.restoreAllMocks());

describe("feishu-card", () => {
  it("firing+critical 卡片为红色并含关键字段", () => {
    const card = JSON.stringify(buildAlertCard({
      state: "firing", severity: "critical", ruleName: "错误激增", targetName: "Prod A",
      metric: "error_count", currentValue: 42, comparator: ">", threshold: 20,
      windowSeconds: 300, firstSeenAt: "2026-06-28T00:00:00.000Z",
    }));
    expect(card).toContain("red");
    expect(card).toContain("错误激增");
    expect(card).toContain("Prod A");
    expect(card).toContain("42");
  });

  it("resolved 卡片为绿色", () => {
    const card = JSON.stringify(buildAlertCard({
      state: "resolved", severity: "warning", ruleName: "R", targetName: "T",
      metric: "ttft_ms", currentValue: 100, comparator: ">", threshold: 6000,
      windowSeconds: 300, firstSeenAt: null,
    }));
    expect(card).toContain("green");
  });

  it("飞书签名稳定可复现", () => {
    const a = signFeishu("mysecret", 1700000000);
    const b = signFeishu("mysecret", 1700000000);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("sendFeishu 首次失败后重试成功", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const webhook: FeishuWebhookRow = {
      id: "w1", name: "W", webhook_url: "https://open.feishu.cn/hook/x", secret: null,
      group_name: null, created_at: "", updated_at: "",
    };
    await sendFeishu(webhook, { msg_type: "interactive", card: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sendFeishu 两次都失败则抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fail", { status: 500 })));
    const webhook: FeishuWebhookRow = {
      id: "w1", name: "W", webhook_url: "https://open.feishu.cn/hook/x", secret: null,
      group_name: null, created_at: "", updated_at: "",
    };
    await expect(sendFeishu(webhook, { msg_type: "interactive", card: {} })).rejects.toThrow();
  });
});
