import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processConsultantNotifications } from "@/lib/consultant/notifications";
import { hasReportWorkerAuthorization } from "@/lib/scheduler-authorization";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const input = z.object({ id: z.uuid() }).strict();

export async function POST(request: NextRequest) {
  if (!hasReportWorkerAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false }, { status: 401, headers });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false }, { status: 400, headers });
  }
  try {
    const result = await processConsultantNotifications(parsed.data.id);
    const success = result.state === "ok";
    return NextResponse.json({ success, data: result }, { status: success ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ success: false }, { status: 503, headers });
  }
}
