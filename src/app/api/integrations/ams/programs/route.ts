import { NextRequest, NextResponse } from "next/server";
import {
  amsProgramCatalogRequestSchema,
  listAmsAssignablePrograms,
  verifyAmsSignature,
} from "@/lib/ams-integration";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = verifyAmsSignature(
    rawBody,
    request.headers.get("x-binahub-timestamp"),
    request.headers.get("x-binahub-signature"),
  );
  if (!verification.ok) {
    return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid." }, { status: 400 });
  }
  const parsed = amsProgramCatalogRequestSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Permintaan katalog program tidak valid." }, { status: 400 });
  }

  try {
    const data = await listAmsAssignablePrograms(parsed.data.requesterEmail);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[AMS program catalog] failed", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Katalog program APP belum dapat dibaca.",
    }, { status: 500 });
  }
}
