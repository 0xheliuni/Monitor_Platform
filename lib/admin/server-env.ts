import "server-only"

/**
 * SQLite 版本的环境检查 — 数据库随应用内嵌，始终可用。
 * 原 Supabase 版本的 server-env.ts 已删除；此文件保留同名导出以兼容页面层代码。
 * Task 10 将在数据层统一完成后删除此文件或合并到 lib/admin/env.ts。
 */
export function hasAdminDatabaseEnv(): boolean {
  return true
}

export function getAdminDatabaseWarnings(): string[] {
  return []
}
