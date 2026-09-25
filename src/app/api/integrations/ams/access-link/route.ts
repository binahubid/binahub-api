import { NextRequest, NextResponse } from "next/server";
import { amsAccessRequestSchema, createAmsAccessTicket, verifyAmsSignature } from "@/lib/ams-integration";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = verifyAmsSignature(rawBody, request.headers.get("x-binahub-timestamp"), request.headers.get("x-binahub-signature"));
  if (!verification.ok) return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });

  const parsed = amsAccessRequestSchema.safeParse(JSON.parse(rawBody || "null"));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Permintaan akses APP tidak valid." }, { status: 400 });

  try {
    const ticket = await createAmsAccessTicket(parsed.data.associate, parsed.data.nextPath);
    return NextResponse.json({ success: true, ...ticket });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat akses APP." }, { status: 500 });
  }
}
