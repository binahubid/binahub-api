import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAmsSignature } from "@/lib/ams-integration";
import { consultantDocumentLink, consultantMaterialCatalog } from "@/lib/consultant/materials";

const schema = z.object({
  purpose: z.literal("ams-admin-materials"),
  requesterId: z.uuid(),
  action: z.enum(["catalog", "document"]),
  slug: z.string().max(64).optional(),
}).strict();
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 2048) return NextResponse.json({ success: false }, { status: 413, headers });
  const signature = verifyAmsSignature(raw, request.headers.get("x-binahub-timestamp"), request.headers.get("x-binahub-signature"));
  if (!signature.ok) return NextResponse.json({ success: false, error: signature.error }, { status: signature.status, headers });
  const input = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!input.success) return NextResponse.json({ success: false, error: "Permintaan materi tidak valid." }, { status: 400, headers });
  if (input.data.action === "catalog") {
    return NextResponse.json({ success: true, data: consultantMaterialCatalog() }, { headers });
  }
  try {
    const document = await consultantDocumentLink(input.data.slug || "");
    if (!document) return NextResponse.json({ success: false, error: "Materi tidak ditemukan." }, { status: 404, headers });
    return NextResponse.json({ success: true, data: document }, { headers });
  } catch {
    return NextResponse.json({ success: false, error: "Dokumen belum dapat dibuka. Coba lagi." }, { status: 503, headers });
  }
}
