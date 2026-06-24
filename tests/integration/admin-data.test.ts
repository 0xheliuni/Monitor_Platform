/**
 * Integration test: admin data layer (Task 10)
 * Seeds an in-memory DB, injects via __setDbForTest, then exercises
 * the admin query and action layer end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { __setDbForTest } from "@/lib/db/client"
import type { AppUser } from "@/lib/admin/types"

const SCHEMA_PATH = resolve(process.cwd(), "lib/db/schema.sql")

function createEmptyDb() {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(readFileSync(SCHEMA_PATH, "utf8"))
  return db
}

const adminUser: AppUser = {
  id: "env-admin",
  email: "",
  displayName: "管理员",
  avatarUrl: null,
  role: "admin",
  groupName: null,
  directoryUserId: null,
  isBootstrapAdmin: true,
}

beforeEach(() => {
  __setDbForTest(createEmptyDb())
})

afterEach(() => {
  __setDbForTest(null)
})

describe("admin data layer — listConfigs / enrichConfigs", () => {
  it("returns created config via listConfigs(adminUser)", async () => {
    const { createTemplate } = await import("@/lib/db/templates")
    const { createModel } = await import("@/lib/db/models")
    const { createConfig } = await import("@/lib/db/configs")
    const { listConfigs } = await import("@/lib/admin/queries")

    // seed: template → model → config
    const tpl = await createTemplate({
      name: "OpenAI Default",
      type: "openai",
      request_header: null,
      metadata: null,
    })

    const model = await createModel({
      type: "openai",
      model: "gpt-4o-mini",
      template_id: tpl.id,
    })

    await createConfig({
      name: "Test Config",
      type: "openai",
      model_id: model.id,
      endpoint: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-test",
      enabled: true,
      is_maintenance: false,
      group_name: "TestGroup",
    })

    const configs = await listConfigs(adminUser)

    expect(configs).toHaveLength(1)
    expect(configs[0].name).toBe("Test Config")
    expect(configs[0].model).toBe("gpt-4o-mini")
    expect(configs[0].template_name).toBe("OpenAI Default")
    expect(configs[0].group_name).toBe("TestGroup")
    expect(configs[0].enabled).toBe(true)
  })
})

describe("admin data layer — setConfigsEnabled", () => {
  it("flips enabled to false via setConfigsEnabled", async () => {
    const { createTemplate } = await import("@/lib/db/templates")
    const { createModel } = await import("@/lib/db/models")
    const { createConfig, setConfigsEnabled, getConfig } = await import("@/lib/db/configs")

    const tpl = await createTemplate({
      name: "Tpl2",
      type: "openai",
      request_header: null,
      metadata: null,
    })

    const model = await createModel({
      type: "openai",
      model: "gpt-4o",
      template_id: tpl.id,
    })

    const cfg = await createConfig({
      name: "Cfg2",
      type: "openai",
      model_id: model.id,
      endpoint: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-x",
      enabled: true,
      is_maintenance: false,
      group_name: null,
    })

    expect(cfg.enabled).toBe(true)

    await setConfigsEnabled([cfg.id], false)

    const updated = await getConfig(cfg.id)
    expect(updated?.enabled).toBe(false)
  })
})

describe("admin data layer — deleteConfig cascades history", () => {
  it("deletes config and its history rows", async () => {
    const { createTemplate } = await import("@/lib/db/templates")
    const { createModel } = await import("@/lib/db/models")
    const {
      createConfig,
      deleteConfig,
      getConfig,
    } = await import("@/lib/db/configs")
    const { insertHistory, getRecentCheckHistory } = await import("@/lib/db/history")

    const tpl = await createTemplate({
      name: "Tpl3",
      type: "openai",
      request_header: null,
      metadata: null,
    })

    const model = await createModel({
      type: "openai",
      model: "gpt-4o-mini-cascade",
      template_id: tpl.id,
    })

    const cfg = await createConfig({
      name: "Cfg3",
      type: "openai",
      model_id: model.id,
      endpoint: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-y",
      enabled: true,
      is_maintenance: false,
      group_name: null,
    })

    // Insert history rows
    await insertHistory([
      {
        config_id: cfg.id,
        status: "operational",
        latency_ms: 100,
        ping_latency_ms: 5,
        checked_at: new Date().toISOString(),
        message: null,
      },
    ])

    const before = await getRecentCheckHistory(10, [cfg.id])
    expect(before).toHaveLength(1)

    // Delete the config — history should cascade delete (ON DELETE CASCADE)
    await deleteConfig(cfg.id)

    const gone = await getConfig(cfg.id)
    expect(gone).toBeNull()

    const after = await getRecentCheckHistory(10, [cfg.id])
    expect(after).toHaveLength(0)
  })
})
