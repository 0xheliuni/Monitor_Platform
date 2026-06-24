/**
 * 端点 Ping 延迟检测工具
 */

const PING_TIMEOUT_MS = 8_000;

/**
 * 尝试从端点 URL 中提取可用于 Ping 的 Origin
 */
function resolvePingOrigin(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

async function tryPing(
  url: string,
  method: "HEAD" | "GET"
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    await fetch(url, {
      method,
      cache: "no-store",
      redirect: "manual",
      headers: {
        "User-Agent": "check-cx/ping",
      },
      signal: controller.signal,
    });
    return Date.now() - startedAt;
  } catch (error) {
    const err = error as Error & { name?: string };
    if (err?.name === "AbortError") {
      return null;
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 测量端点 Ping 延迟
 * @returns 成功时的延迟(毫秒)，失败时返回 null
 */
export async function measureEndpointPing(
  endpoint: string | null | undefined
): Promise<number | null> {
  if (!endpoint) {
    return null;
  }

  const origin = resolvePingOrigin(endpoint);
  if (!origin) {
    return null;
  }

  const headLatency = await tryPing(origin, "HEAD");
  if (headLatency !== null) {
    return headLatency;
  }

  return tryPing(origin, "GET");
}
