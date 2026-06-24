import "server-only"

import {
  AdminDirectoryUserRecord,
  AppUser,
  AvailabilityStatRecord,
  CheckConfigRecord,
  CheckHistoryRecord,
  CheckModelRecord,
  CheckRequestTemplateRecord,
  DashboardSummary,
  GroupInfoRecord,
  SystemNotificationRecord,
} from "@/lib/admin/types"
import { getRequiredGroupName, isAdminUser } from "@/lib/admin/permissions"

import * as dbConfigs from "@/lib/db/configs"
import * as dbModels from "@/lib/db/models"
import * as dbTemplates from "@/lib/db/templates"
import * as dbGroups from "@/lib/db/groups"
import * as dbNotifications from "@/lib/db/notifications"
import { getRecentCheckHistory } from "@/lib/db/history"
import { getAvailabilityStats } from "@/lib/db/availability"

// ─── scope helpers ───────────────────────────────────────────────────────────

/** Returns null for admin (= no filter), or a group name string for members. */
function getScopeGroup(user: AppUser): string | null {
  if (isAdminUser(user)) return null
  return getRequiredGroupName(user)
}

/**
 * Returns null for admin (no id restriction), or an array of config ids
 * belonging to the user's group. Returns empty array if group has no configs.
 */
async function listScopedConfigIds(user: AppUser): Promise<string[] | null> {
  if (isAdminUser(user)) return null
  const scopeGroup = getRequiredGroupName(user)
  const configs = await dbConfigs.listConfigs(scopeGroup)
  return configs.map((c) => c.id)
}

// ─── config shape mapping ─────────────────────────────────────────────────────

/**
 * listConfigs returns ConfigRow (no model/template_name).
 * We need to enrich with model name + template info via a models lookup.
 */
async function enrichConfigs(rows: dbConfigs.ConfigRow[]): Promise<CheckConfigRecord[]> {
  if (rows.length === 0) return []

  // Fetch all models in one call, then build a lookup map
  const allModels = await dbModels.listModels()
  const modelMap = new Map(allModels.map((m) => [m.id, m]))

  // Fetch all templates
  const allTemplates = await dbTemplates.listTemplates()
  const templateMap = new Map(allTemplates.map((t) => [t.id, t]))

  return rows.map((row) => {
    const model = modelMap.get(row.model_id)
    const template = model?.template_id ? templateMap.get(model.template_id) : undefined
    return {
      id: row.id,
      name: row.name,
      type: row.type as CheckConfigRecord["type"],
      model_id: row.model_id,
      model: model?.model ?? "",
      template_id: model?.template_id ?? null,
      template_name: template?.name ?? null,
      endpoint: row.endpoint,
      api_key: row.api_key,
      enabled: row.enabled,
      is_maintenance: row.is_maintenance,
      group_name: row.group_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  })
}

// ─── dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardSummary(user: AppUser): Promise<DashboardSummary> {
  const scopeGroup = getScopeGroup(user)
  const configs = await dbConfigs.listConfigs(scopeGroup)

  if (!isAdminUser(user)) {
    const scopedIds = configs.map((c) => c.id)
    let recentErrorCount = 0

    if (scopedIds.length > 0) {
      const history = await getRecentCheckHistory(1, scopedIds)
      // Count entries whose status is a failure status — but getDashboardSummary
      // originally counted from check_history directly; use availability proxy: just
      // list recent history with a large per-config limit and filter statuses.
      const errorHistory = await getRecentCheckHistory(50, scopedIds)
      recentErrorCount = errorHistory.filter((h) =>
        h.status === "failed" || h.status === "validation_failed" || h.status === "error"
      ).length
      void history // silence unused
    }

    return {
      modelCount: new Set(configs.map((c) => c.model_id)).size,
      configCount: configs.length,
      enabledConfigCount: configs.filter((c) => c.enabled).length,
      maintenanceConfigCount: configs.filter((c) => c.is_maintenance).length,
      templateCount: 0, // members don't get template info from config row
      groupCount: new Set(configs.map((c) => c.group_name).filter(Boolean)).size,
      activeNotificationCount: 0,
      recentErrorCount,
    }
  }

  // Admin: fetch all counts in parallel
  const [allModels, allTemplates, allGroups, activeNotifications, recentErrorHistory] =
    await Promise.all([
      dbModels.listModels(),
      dbTemplates.listTemplates(),
      dbGroups.listGroups(),
      dbNotifications.listActiveNotifications(),
      getRecentCheckHistory(50, null),
    ])

  const recentErrorCount = recentErrorHistory.filter((h) =>
    h.status === "failed" || h.status === "validation_failed" || h.status === "error"
  ).length

  return {
    modelCount: allModels.length,
    configCount: configs.length,
    enabledConfigCount: configs.filter((c) => c.enabled).length,
    maintenanceConfigCount: configs.filter((c) => c.is_maintenance).length,
    templateCount: allTemplates.length,
    groupCount: allGroups.length,
    activeNotificationCount: activeNotifications.length,
    recentErrorCount,
  }
}

// ─── configs ──────────────────────────────────────────────────────────────────

export async function listConfigs(user: AppUser): Promise<CheckConfigRecord[]> {
  const scopeGroup = getScopeGroup(user)
  const rows = await dbConfigs.listConfigs(scopeGroup)
  return enrichConfigs(rows)
}

export async function getConfigById(id: string, user: AppUser): Promise<CheckConfigRecord | null> {
  const scopeGroup = getScopeGroup(user)
  const rows = await dbConfigs.listConfigs(scopeGroup)
  const row = rows.find((r) => r.id === id)
  if (!row) return null
  const enriched = await enrichConfigs([row])
  return enriched[0] ?? null
}

// ─── models ───────────────────────────────────────────────────────────────────

export async function listModels(user?: AppUser): Promise<CheckModelRecord[]> {
  const allModels = await dbModels.listModels()
  const allTemplates = await dbTemplates.listTemplates()
  const templateMap = new Map(allTemplates.map((t) => [t.id, t]))

  // Build config_count map
  const allConfigs = await dbConfigs.listConfigs()
  const countMap = new Map<string, number>()
  for (const c of allConfigs) {
    countMap.set(c.model_id, (countMap.get(c.model_id) ?? 0) + 1)
  }

  let filtered = allModels

  if (user && !isAdminUser(user)) {
    // Scope to models referenced by user's configs
    const scopeGroup = getRequiredGroupName(user)
    const scopedConfigs = await dbConfigs.listConfigs(scopeGroup)
    const scopedModelIds = new Set(scopedConfigs.map((c) => c.model_id))
    filtered = allModels.filter((m) => scopedModelIds.has(m.id))
  }

  return filtered.map((m) => {
    const template = m.template_id ? templateMap.get(m.template_id) : undefined
    return {
      id: m.id,
      type: m.type as CheckModelRecord["type"],
      model: m.model,
      template_id: m.template_id ?? null,
      template_name: template?.name ?? null,
      created_at: m.created_at,
      updated_at: m.updated_at,
      config_count: countMap.get(m.id) ?? 0,
    }
  })
}

export async function listSelectableModels(): Promise<CheckModelRecord[]> {
  return listModels()
}

export async function listModelsByType(type: CheckModelRecord["type"]): Promise<CheckModelRecord[]> {
  const all = await listModels()
  return all.filter((m) => m.type === type)
}

export async function getModelById(id: string): Promise<CheckModelRecord | null> {
  const model = await dbModels.getModel(id)
  if (!model) return null

  const allTemplates = await dbTemplates.listTemplates()
  const templateMap = new Map(allTemplates.map((t) => [t.id, t]))
  const template = model.template_id ? templateMap.get(model.template_id) : undefined

  const configCount = await dbModels.countConfigsByModel(id)

  return {
    id: model.id,
    type: model.type as CheckModelRecord["type"],
    model: model.model,
    template_id: model.template_id ?? null,
    template_name: template?.name ?? null,
    created_at: model.created_at,
    updated_at: model.updated_at,
    config_count: configCount,
  }
}

// ─── templates ────────────────────────────────────────────────────────────────

export async function listTemplates(user?: AppUser): Promise<CheckRequestTemplateRecord[]> {
  const allTemplates = await dbTemplates.listTemplates()
  const allModels = await dbModels.listModels()

  const countMap = new Map<string, number>()
  for (const m of allModels) {
    if (m.template_id) {
      countMap.set(m.template_id, (countMap.get(m.template_id) ?? 0) + 1)
    }
  }

  let filtered = allTemplates

  if (user && !isAdminUser(user)) {
    // Scope to templates used by models referenced by user's configs
    const models = await listModels(user)
    const usedTemplateIds = new Set(
      models.map((m) => m.template_id).filter((id): id is string => Boolean(id))
    )
    filtered = allTemplates.filter((t) => usedTemplateIds.has(t.id))
  }

  return filtered.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type as CheckRequestTemplateRecord["type"],
    request_header: (t.request_header ?? null) as CheckRequestTemplateRecord["request_header"],
    metadata: (t.metadata ?? null) as CheckRequestTemplateRecord["metadata"],
    created_at: t.created_at,
    updated_at: t.updated_at,
    model_count: countMap.get(t.id) ?? 0,
  }))
}

export async function getTemplateById(id: string): Promise<CheckRequestTemplateRecord | null> {
  const template = await dbTemplates.getTemplate(id)
  if (!template) return null

  const modelCount = await dbTemplates.countModelsByTemplate(id)

  return {
    id: template.id,
    name: template.name,
    type: template.type as CheckRequestTemplateRecord["type"],
    request_header: (template.request_header ?? null) as CheckRequestTemplateRecord["request_header"],
    metadata: (template.metadata ?? null) as CheckRequestTemplateRecord["metadata"],
    created_at: template.created_at,
    updated_at: template.updated_at,
    model_count: modelCount,
  }
}

// ─── groups ───────────────────────────────────────────────────────────────────

export async function listGroups(): Promise<GroupInfoRecord[]> {
  const rows = await dbGroups.listGroups()
  return rows.map((r) => ({
    id: r.id,
    group_name: r.group_name,
    website_url: r.website_url,
    tags: r.tags,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))
}

export async function getGroupById(id: string): Promise<GroupInfoRecord | null> {
  const groups = await dbGroups.listGroups()
  const row = groups.find((g) => g.id === id)
  if (!row) return null
  return {
    id: row.id,
    group_name: row.group_name,
    website_url: row.website_url,
    tags: row.tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ─── admin users ──────────────────────────────────────────────────────────────
// The SQLite schema has no admin_users table. The app uses single-key login
// (env ADMIN_LOGIN_KEY) and buildSyntheticAdmin() in lib/admin/auth.ts.
// We return an empty array — callers (users list page) will render an empty table,
// which is correct: there are no directory users to manage.

export async function listAdminUsers(): Promise<AdminDirectoryUserRecord[]> {
  return []
}

// ─── notifications ────────────────────────────────────────────────────────────

export async function listNotifications(): Promise<SystemNotificationRecord[]> {
  const rows = await dbNotifications.listNotifications()
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    is_active: r.is_active,
    level: r.level as SystemNotificationRecord["level"],
    created_at: r.created_at,
  }))
}

export async function getNotificationById(id: string): Promise<SystemNotificationRecord | null> {
  const row = await dbNotifications.getNotification(id)
  if (!row) return null
  return {
    id: row.id,
    message: row.message,
    is_active: row.is_active,
    level: row.level as SystemNotificationRecord["level"],
    created_at: row.created_at,
  }
}

// ─── history ──────────────────────────────────────────────────────────────────

export async function listRecentHistory(user: AppUser, limit = 120): Promise<CheckHistoryRecord[]> {
  const scopedIds = await listScopedConfigIds(user)

  if (scopedIds !== null && scopedIds.length === 0) {
    return []
  }

  const rows = await getRecentCheckHistory(limit, scopedIds)

  return rows.map((row, idx) => ({
    id: idx + 1,
    config_id: row.config_id,
    status: row.status as CheckHistoryRecord["status"],
    latency_ms: row.latency_ms,
    ping_latency_ms: row.ping_latency_ms,
    checked_at: row.checked_at,
    message: row.message,
    created_at: row.checked_at,
    check_configs: {
      id: row.config_id,
      name: row.name,
      type: row.type as CheckConfigRecord["type"],
      model_id: "",
      model: row.model,
      group_name: row.group_name,
    },
  }))
}

// ─── availability ─────────────────────────────────────────────────────────────

export async function listAvailabilityStats(user: AppUser): Promise<AvailabilityStatRecord[]> {
  const scopedIds = await listScopedConfigIds(user)

  if (scopedIds !== null && scopedIds.length === 0) {
    return []
  }

  const rows = await getAvailabilityStats(scopedIds)

  return rows.map((r) => ({
    config_id: r.config_id,
    period: r.period,
    total_checks: r.total_checks,
    operational_count: r.operational_count,
    availability_pct: r.availability_pct,
  }))
}

// ─── getPollerLease REMOVED ───────────────────────────────────────────────────
// The lease table was removed in Task 8. Callers (system/page.tsx) have been
// updated to show a static "进程内单实例运行" note instead.
