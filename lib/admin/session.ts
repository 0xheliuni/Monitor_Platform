import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"

export const SESSION_COOKIE_NAME = "admin_session"

// 10 年（秒），实际等同永久；浏览器仍按 cookie 协议处理
const PERMANENT_MAX_AGE = 60 * 60 * 24 * 365 * 10

type SessionPayload = {
  sub: string
  iat: number
}

function readEnv(name: string) {
  return process.env[name]?.trim() ?? ""
}

export function getAdminLoginKey() {
  return readEnv("ADMIN_LOGIN_KEY")
}

export function getSessionSecret() {
  return readEnv("ADMIN_SESSION_SECRET")
}

export function hasAdminAuthEnv() {
  return Boolean(getAdminLoginKey() && getSessionSecret())
}

export function getAdminAuthWarnings() {
  const warnings: string[] = []

  if (!getAdminLoginKey()) {
    warnings.push("缺少 ADMIN_LOGIN_KEY")
  }

  if (!getSessionSecret()) {
    warnings.push("缺少 ADMIN_SESSION_SECRET")
  }

  return warnings
}

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function base64UrlDecode(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/")
  const padLength = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + "=".repeat(padLength), "base64")
}

function sign(payload: string, secret: string) {
  return base64UrlEncode(createHmac("sha256", secret).update(payload).digest())
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  if (bufA.length !== bufB.length) {
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

export function buildSessionToken(payload?: Partial<SessionPayload>) {
  const secret = getSessionSecret()

  if (!secret) {
    throw new Error("缺少 ADMIN_SESSION_SECRET")
  }

  const body: SessionPayload = {
    sub: payload?.sub ?? "admin",
    iat: payload?.iat ?? Math.floor(Date.now() / 1000),
  }

  const encoded = base64UrlEncode(JSON.stringify(body))
  const signature = sign(encoded, secret)
  return `${encoded}.${signature}`
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) {
    return null
  }

  const secret = getSessionSecret()

  if (!secret) {
    return null
  }

  const parts = token.split(".")
  if (parts.length !== 2) {
    return null
  }

  const [encoded, signature] = parts
  const expected = sign(encoded, secret)

  if (!safeEqual(signature, expected)) {
    return null
  }

  try {
    const body = JSON.parse(base64UrlDecode(encoded).toString("utf8")) as SessionPayload

    if (typeof body?.sub !== "string" || typeof body?.iat !== "number") {
      return null
    }

    return body
  } catch {
    return null
  }
}

export async function readSessionFromCookies() {
  const store = await cookies()
  const value = store.get(SESSION_COOKIE_NAME)?.value
  return verifySessionToken(value)
}

export type SessionCookieOptions = {
  secure?: boolean
}

export function buildSessionCookieAttributes(options: SessionCookieOptions = {}) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.secure ?? process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PERMANENT_MAX_AGE,
  }
}

export function buildClearSessionCookieAttributes(options: SessionCookieOptions = {}) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.secure ?? process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  }
}
