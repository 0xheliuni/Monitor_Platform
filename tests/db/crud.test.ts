import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { __setDbForTest } from "@/lib/db/client";
import { createTemplate, listTemplates, updateTemplate } from "@/lib/db/templates";
import { createModel, listModels } from "@/lib/db/models";
import { createGroup, listGroups, updateGroup } from "@/lib/db/groups";
import { createNotification, listNotifications, listActiveNotifications, updateNotification, getNotification } from "@/lib/db/notifications";

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "lib/db/schema.sql"), "utf8"));
  __setDbForTest(db);
}
beforeEach(() => seed());

describe("templates CRUD", () => {
  it("createTemplate 后 listTemplates 包含该模板", async () => {
    const tpl = await createTemplate({ name: "tmpl-1", type: "openai", request_header: { a: "1" }, metadata: { x: 2 } });
    expect(tpl.id).toBeTruthy();
    expect(tpl.name).toBe("tmpl-1");
    expect(tpl.request_header).toEqual({ a: "1" });
    expect(tpl.metadata).toEqual({ x: 2 });
    const list = await listTemplates();
    expect(list.some((t) => t.id === tpl.id)).toBe(true);
  });

  it("updateTemplate 更新 updated_at", async () => {
    const tpl = await createTemplate({ name: "tmpl-2", type: "gemini", request_header: null, metadata: null });
    const before = tpl.updated_at;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updateTemplate(tpl.id, { name: "tmpl-2-upd" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("tmpl-2-upd");
    expect(updated!.updated_at >= before).toBe(true);
  });
});

describe("models CRUD", () => {
  it("createModel 后 listModels 包含该模型", async () => {
    const model = await createModel({ type: "openai", model: "gpt-4o" });
    expect(model.id).toBeTruthy();
    const list = await listModels();
    expect(list.some((m) => m.id === model.id)).toBe(true);
  });
});

describe("groups CRUD", () => {
  it("createGroup 后 listGroups 包含该分组", async () => {
    const g = await createGroup({ group_name: "GroupA", website_url: "https://example.com", tags: "prod" });
    expect(g.id).toBeTruthy();
    expect(g.group_name).toBe("GroupA");
    expect(g.website_url).toBe("https://example.com");
    expect(g.tags).toBe("prod");
    const list = await listGroups();
    expect(list.some((row) => row.id === g.id)).toBe(true);
  });

  it("updateGroup 更新 updated_at", async () => {
    const g = await createGroup({ group_name: "GroupB" });
    const before = g.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updateGroup(g.id, { tags: "staging" });
    expect(updated).not.toBeNull();
    expect(updated!.tags).toBe("staging");
    expect(updated!.updated_at >= before).toBe(true);
  });
});

describe("notifications CRUD", () => {
  it("createNotification is_active=true 出现在 listActiveNotifications", async () => {
    const n = await createNotification({ message: "Hello world", is_active: true, level: "info" });
    expect(n.id).toBeTruthy();
    expect(n.is_active).toBe(true);
    const active = await listActiveNotifications();
    expect(active.some((row) => row.id === n.id)).toBe(true);
  });

  it("createNotification is_active=false 不出现在 listActiveNotifications", async () => {
    const n = await createNotification({ message: "Inactive", is_active: false, level: "warning" });
    expect(n.is_active).toBe(false);
    const active = await listActiveNotifications();
    expect(active.some((row) => row.id === n.id)).toBe(false);
    const all = await listNotifications();
    expect(all.some((row) => row.id === n.id)).toBe(true);
  });

  it("同时创建 active 和 inactive，listActiveNotifications 只含 active", async () => {
    const a = await createNotification({ message: "Active one", is_active: true, level: "info" });
    const b = await createNotification({ message: "Inactive one", is_active: false, level: "error" });
    const active = await listActiveNotifications();
    expect(active.some((r) => r.id === a.id)).toBe(true);
    expect(active.some((r) => r.id === b.id)).toBe(false);
  });

  it("updateNotification 更新 message 和 is_active 后持久化", async () => {
    const n = await createNotification({ message: "Original message", is_active: true, level: "info" });
    await updateNotification(n.id, { message: "Updated message", is_active: false });
    const updated = await getNotification(n.id);
    expect(updated).not.toBeNull();
    expect(updated!.message).toBe("Updated message");
    expect(updated!.is_active).toBe(false);
  });
});
