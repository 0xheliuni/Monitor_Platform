import { NextResponse } from "next/server";
import { getTargetsOverview } from "@/lib/core/monitor-dashboard";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTargetsOverview();
  return NextResponse.json(data, { headers: { "Cache-Control": "public, no-cache" } });
}
