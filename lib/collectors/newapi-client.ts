import "server-only";
import type { MonitorTargetRow } from "../types/monitor";

const REQUEST_TIMEOUT_MS = 15_000;

export function unixToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

export function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function joinUrl(baseUrl: string, path: string, query?: Record<string, string | number>): string {
  const base = baseUrl.replace(/\/+$/, "");
  const qs = query
    ? "?" + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : "";
  return `${base}${path}${qs}`;
}

export async function newapiGet(
  target: MonitorTargetRow,
  path: string,
  query?: Record<string, string | number>
): Promise<unknown> {
  if (!target.admin_token || !target.admin_user_id) {
    throw new Error(`目标 ${target.name} 缺少 admin token / user id，无法拉取`);
  }
  const url = joinUrl(target.base_url, path, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": target.admin_token,
        "New-Api-User": target.admin_user_id,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`newapi ${path} HTTP ${res.status}`);
    const body = (await res.json()) as { success?: boolean; data?: unknown; message?: string };
    if (body.success === false) throw new Error(body.message || `newapi ${path} 返回 success=false`);
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
