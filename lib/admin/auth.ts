import "server-only"

import { redirect } from "next/navigation"

import { hasAdminAuthEnv, readSessionFromCookies } from "@/lib/admin/session"
import { AppUser } from "@/lib/admin/types"

function buildSyntheticAdmin(): AppUser {
  return {
    id: "env-admin",
    email: "",
    displayName: "管理员",
    avatarUrl: null,
    role: "admin",
    groupName: null,
    directoryUserId: null,
    isBootstrapAdmin: true,
  }
}

export async function getOptionalAppUser(): Promise<AppUser | null> {
  if (!hasAdminAuthEnv()) {
    return null
  }

  const session = await readSessionFromCookies()

  if (!session) {
    return null
  }

  return buildSyntheticAdmin()
}

export async function requireAppUser() {
  const user = await getOptionalAppUser()

  if (!user) {
    redirect("/admin/login")
  }

  return user
}

export async function getOptionalAdminUser() {
  const user = await getOptionalAppUser()

  if (!user || user.role !== "admin") {
    return null
  }

  return user
}

export async function requireAdminUser() {
  const user = await getOptionalAdminUser()

  if (!user) {
    redirect("/admin/login")
  }

  return user
}
