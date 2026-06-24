import { NextResponse } from "next/server"

import { getRequestOrigin } from "@/lib/admin/env"
import { buildClearSessionCookieAttributes } from "@/lib/admin/session"

function buildResponse(origin: string) {
  const response = NextResponse.redirect(new URL("/admin/login", origin), 303)
  response.cookies.set({
    ...buildClearSessionCookieAttributes(),
    value: "",
  })
  return response
}

export async function GET(request: Request) {
  return buildResponse(getRequestOrigin(request))
}

export async function POST(request: Request) {
  return buildResponse(getRequestOrigin(request))
}
