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

describe("admin data layer — listModels / listConfigs scoped to member group (Fix 2)", () => {
  it("non-admin member only sees configs and model config_count for their own group", async () => {
    const { createTemplate } = await import("@/lib/db/templates")
    const { createModel } = await import("@/lib/db/models")
    const { createConfig, listConfigs: dbListConfigs } = await import("@/lib/db/configs")
    const { listModels, listConfigs } = await import("@/lib/admin/queries")

    // Seed a template and two models
    const tpl = await createTemplate({
      name: "TplFix2",
      type: "openai",
      request_header: null,
      metadata: null,
    })

    const modelG1 = await createModel({ type: "openai", model: "gpt-fix2-g1", template_id: tpl.id })
    const modelG2 = await createModel({ type: "openai", model: "gpt-fix2-g2", template_id: tpl.id })

    // Seed one config in G1 and one config in G2 for the same model slot
    await createConfig({
      name: "Config-G1",
      type: "openai",
      model_id: modelG1.id,
      endpoint: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-g1",
      enabled: true,
      is_maintenance: false,
      group_name: "G1",
    })

    await createConfig({
      name: "Config-G2",
      type: "openai",
      model_id: modelG2.id,
      endpoint: "https://api.openai.com/v1/chat/completions",
      api_key: "sk-g2",
      enabled: true,
      is_maintenance: false,
      group_name: "G2",
    })

    const memberUser: AppUser = {
      id: "member-1",
      email: "member@example.com",
      displayName: "Member",
      avatarUrl: null,
      role: "member",
      groupName: "G1",
      directoryUserId: null,
      isBootstrapAdmin: false,
    }

    // listConfigs scoped: member sees only G1
    const memberConfigs = await listConfigs(memberUser)
    expect(memberConfigs).toHaveLength(1)
    expect(memberConfigs[0].name).toBe("Config-G1")
    expect(memberConfigs[0].group_name).toBe("G1")

    // listModels scoped: member sees only modelG1, and config_count = 1 (only G1 config)
    const memberModels = await listModels(memberUser)
    expect(memberModels).toHaveLength(1)
    expect(memberModels[0].id).toBe(modelG1.id)
    expect(memberModels[0].config_count).toBe(1)

    // Admin sees both configs and both models with correct global counts
    const adminModels = await listModels(adminUser)
    expect(adminModels.length).toBeGreaterThanOrEqual(2)
    const adminModelG1 = adminModels.find((m) => m.id === modelG1.id)
    const adminModelG2 = adminModels.find((m) => m.id === modelG2.id)
    expect(adminModelG1?.config_count).toBe(1)
    expect(adminModelG2?.config_count).toBe(1)

    // Verify db-level listConfigs with group arg (raw)
    const rawG1 = await dbListConfigs("G1")
    expect(rawG1).toHaveLength(1)
    expect(rawG1[0].name).toBe("Config-G1")
  })
})
