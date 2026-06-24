import { NextResponse } from "next/server"

import { getRequestOrigin, sanitizeRedirectPath } from "@/lib/admin/env"
import {
  buildSessionCookieAttributes,
  buildSessionToken,
  getAdminLoginKey,
  hasAdminAuthEnv,
} from "@/lib/admin/session"

function redirectTo(path: string, origin: string) {
  return NextResponse.redirect(new URL(path, origin), 303)
}

export async function POST(request: Request) {
  const origin = getRequestOrigin(request)
  const formData = await request.formData()
  const submittedKey = String(formData.get("key") ?? "")
  const next = sanitizeRedirectPath(String(formData.get("next") ?? "/admin"))

  if (!hasAdminAuthEnv()) {
    return redirectTo("/admin/login?error=missing-env", origin)
  }

  if (!submittedKey || submittedKey !== getAdminLoginKey()) {
    const params = new URLSearchParams({ error: "invalid-key" })
    if (next && next !== "/admin") {
      params.set("next", next)
    }
    return redirectTo(`/admin/login?${params.toString()}`, origin)
  }

  const token = buildSessionToken()
  const response = redirectTo(next, origin)
  response.cookies.set({
    ...buildSessionCookieAttributes(),
    value: token,
  })

  return response
}
