import { describe, it, expect } from "vitest";
import { parseTaskConfig, parseRuleNumbers } from "@/app/admin/(protected)/monitor-tasks/form-utils";

describe("monitor 表单解析", () => {
  it("parseTaskConfig 把 model/format/endpoint 收进 config 对象", () => {
    const fd = new FormData();
    fd.set("model", "gpt-4o-mini");
    fd.set("format", "openai");
    fd.set("endpoint", "");
    expect(parseTaskConfig(fd)).toEqual({ model: "gpt-4o-mini", format: "openai" });
  });

  it("parseRuleNumbers 解析阈值/窗口/连续次数", () => {
    const fd = new FormData();
    fd.set("threshold", "20");
    fd.set("window_seconds", "300");
    fd.set("consecutive_breaches", "2");
    expect(parseRuleNumbers(fd)).toEqual({ threshold: 20, window_seconds: 300, consecutive_breaches: 2 });
  });
});
