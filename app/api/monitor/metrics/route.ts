import { NextResponse } from "next/server";
import { querySeries } from "@/lib/db/samples";
import { toPublicSample } from "@/lib/core/monitor-dashboard";
import type { MetricName } from "@/lib/types/monitor";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("target");
  const metric = searchParams.get("metric") as MetricName | null;
  if (!target || !metric) {
    return NextResponse.json({ error: "target 和 metric 必填" }, { status: 400 });
  }
  const to = searchParams.get("to") ?? new Date().toISOString();
  const from = searchParams.get("from") ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  const series = await querySeries(target, metric, from, to);
  return NextResponse.json(series.map(toPublicSample), { headers: { "Cache-Control": "public, no-cache" } });
}
