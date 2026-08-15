import { NextRequest, NextResponse } from "next/server";
import { requireTransformationAdmin } from "@/lib/transformation/auth";
import { getAccessCodesForEngagement, getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  if (!engagementId) {
    return NextResponse.json({ success: false, error: "engagement_id wajib diisi." }, { status: 400 });
  }

  try {
    const codes = await getAccessCodesForEngagement(getDb(), engagementId);
    return NextResponse.json({ success: true, accessCodes: codes });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal mengambil kode akses." }, { status: 500 });
  }
}
