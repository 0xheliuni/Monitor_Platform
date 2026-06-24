import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTemplate } from "@/lib/db/templates";
import { createModel } from "@/lib/db/models";
import { createConfig, loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("configs/models type validation", () => {
  it("model.type 与 template.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { a: "1" }, metadata: { x: 1 } });
    await expect(createModel({ type: "anthropic", model: "claude", template_id: tpl.id }))
      .rejects.toThrow("模板类型不匹配");
  });

  it("config.type 与 model.type 不一致抛错", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: null, metadata: null });
    const model = await createModel({ type: "openai", model: "gpt", template_id: tpl.id });
    await expect(createConfig({ name: "c", type: "anthropic", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: null }))
      .rejects.toThrow("模型类型不匹配");
  });

  it("loadEnabledConfigsWithModelTemplate 返回 JSON 解析后的模板", async () => {
    const tpl = await createTemplate({ name: "t", type: "openai", request_header: { Authorization: "Bearer x" }, metadata: { temperature: 0 } });
    const model = await createModel({ type: "openai", model: "gpt-4o", template_id: tpl.id });
    await createConfig({ name: "c", type: "openai", model_id: model.id, endpoint: "http://x", api_key: "k", enabled: true, is_maintenance: false, group_name: "G" });
    const rows = await loadEnabledConfigsWithModelTemplate();
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe("gpt-4o");
    expect(rows[0].request_header).toEqual({ Authorization: "Bearer x" });
    expect(rows[0].metadata).toEqual({ temperature: 0 });
  });
});
