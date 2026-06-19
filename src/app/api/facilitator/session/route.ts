import { NextRequest, NextResponse } from "next/server";
import { requireFacilitator } from "@/lib/facilitator-auth";

export async function GET(req: NextRequest) {
  const facilitator = await requireFacilitator(req);
  if ("error" in facilitator) {
    return NextResponse.json({ success: false, error: facilitator.error }, { status: facilitator.status });
  }

  return NextResponse.json({ success: true, facilitator });
}

