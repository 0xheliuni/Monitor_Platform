import { NextResponse } from "next/server";
import { getTargetDetail } from "@/lib/core/monitor-dashboard";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getTargetDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "public, no-cache" } });
}
