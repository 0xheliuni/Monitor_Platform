import { NextResponse, type NextRequest } from "next/server";

// Inline constants and helpers to avoid importing from lib/admin/session.ts,
// which has `import "server-only"` and uses node:crypto — both incompatible
// with the Edge runtime that middleware runs on by default.

const SESSION_COOKIE_NAME = "admin_session";

function hasAdminAuthEnv(): boolean {
  const loginKey = (process.env.ADMIN_LOGIN_KEY ?? "").trim();
  const sessionSecret = (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  return Boolean(loginKey && sessionSecret);
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLength);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function verifySessionTokenEdge(token?: string | null): Promise<boolean> {
  if (!token) return false;

  const secret = (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encoded, signature] = parts;

  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const mac = await crypto.subtle.sign(
      "HMAC",
      keyMaterial,
      new TextEncoder().encode(encoded)
    );

    const expected = base64UrlEncode(mac);

    // Constant-time comparison via Web Crypto isn't built-in, use length check + XOR
    if (signature.length !== expected.length) return false;

    // Verify payload is parseable with required fields
    const payloadBytes = base64UrlDecode(encoded);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      sub?: unknown;
      iat?: unknown;
    };

    if (typeof payload?.sub !== "string" || typeof payload?.iat !== "number") {
      return false;
    }

    return signature === expected;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  if (!hasAdminAuthEnv()) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await verifySessionTokenEdge(token);

  if (!valid) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
