"use server"

import { redirect } from "next/navigation"

import { requireAdminUser } from "@/lib/admin/auth"
import { withMessage } from "@/lib/admin/forms"

// The SQLite schema has no admin_users table.
// The app uses single-key login (env ADMIN_LOGIN_KEY) via lib/admin/auth.ts,
// so there is one synthetic admin and no user directory to manage.
// All user management actions are disabled — they redirect with an informational error.

export async function inviteAdminUserAction(_formData: FormData) {
  await requireAdminUser()
  redirect(withMessage("/admin/users", "error", "当前版本使用单密钥登录，不支持邀请成员"))
}
