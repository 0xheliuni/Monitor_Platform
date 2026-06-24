import "server-only"

function readEnv(name: string) {
  return process.env[name]?.trim() ?? ""
}

function readHeader(headers: Headers, name: string) {
  return headers.get(name)?.split(",")[0]?.trim() ?? ""
}

function normalizeOrigin(value: string) {
  if (!value) {
    return ""
  }

  try {
    return new URL(value).origin
  } catch {
    return ""
  }
}

export function getAppUrl() {
  return normalizeOrigin(readEnv("APP_URL") || readEnv("SITE_URL"))
}

export function getRequestOrigin(request: Request) {
  const appUrl = getAppUrl()

  if (appUrl) {
    return appUrl
  }

  const requestUrl = new URL(request.url)
  const forwardedProto = readHeader(request.headers, "x-forwarded-proto")
  const forwardedHost = readHeader(request.headers, "x-forwarded-host")
  const host = forwardedHost || readHeader(request.headers, "host") || requestUrl.host
  const protocol = forwardedProto || requestUrl.protocol.replace(":", "")

  return `${protocol}://${host}`
}

export function sanitizeRedirectPath(path?: string | null) {
  if (!path || !path.startsWith("/")) {
    return "/admin"
  }

  return path
}
