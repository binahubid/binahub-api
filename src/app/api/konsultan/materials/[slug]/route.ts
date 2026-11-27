import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { spinOrigin } from "@/lib/spin/http";
import { consultantDocuments } from "@/lib/consultant/materials";
import {
  consultantFailure,
  consultantHeaders,
  requireConsultant,
  ConsultantError,
} from "@/lib/consultant/http";
const bucket = "consultant-materials";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const actor = await requireConsultant(req);
    const { slug } = await ctx.params;
    const view = req.nextUrl.searchParams.get("view");
    const reading = view === "reader";
    const preview = view === "preview" && slug === "product-knowledge";
    const pageNumber = Number(req.nextUrl.searchParams.get("page") ?? 1);
    if (preview && (!Number.isSafeInteger(pageNumber) || pageNumber < 1)) {
      throw new ConsultantError("CONSULTANT_MATERIAL_PAGE_NOT_FOUND", 404);
    }
    if (slug === "product-knowledge" && !reading && !preview && !actor.isAdmin) {
      throw new ConsultantError("CONSULTANT_MATERIAL_READ_ONLY", 403);
    }
    const document = consultantDocuments.find((entry) => entry.slug === slug);
    if (!document)
      throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const { data, error } = await createServerSupabase()
      .storage.from(bucket)
      .download(document.storageName);
    if (error || !data)
      throw new ConsultantError("CONSULTANT_MATERIAL_UNAVAILABLE", 404);
    if (preview) {
      const { consultantPreviewPage } = await import("@/lib/consultant/material-reading");
      const page = await consultantPreviewPage(new Uint8Array(await data.arrayBuffer()), pageNumber);
      if (!page) throw new ConsultantError("CONSULTANT_MATERIAL_PAGE_NOT_FOUND", 404);
      return NextResponse.json(page, { headers: consultantHeaders });
    }
    if (reading && slug === "product-knowledge") {
      const { consultantReadingPages } = await import("@/lib/consultant/material-reading");
      const pages = await consultantReadingPages(new Uint8Array(await data.arrayBuffer()));
      return NextResponse.json({ pages }, { headers: consultantHeaders });
    }
    return new NextResponse(data, {
      headers: {
        ...consultantHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${document.filename}"`,
      },
    });
  } catch (e) {
    return consultantFailure(e);
  }
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const auth = await requireAdmin(req);
  if ("error" in auth)
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: consultantHeaders },
    );
  try {
    spinOrigin(req);
    const { slug } = await ctx.params;
    const document = consultantDocuments.find((entry) => entry.slug === slug);
    if (!document)
      throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const length = Number(req.headers.get("content-length"));
    if (
      !length ||
      length > 4_000_000 ||
      req.headers.get("content-type") !== "application/pdf"
    )
      throw new ConsultantError("CONSULTANT_INVALID_PDF", 400);
    const bytes = Buffer.from(await req.arrayBuffer());
    if (
      bytes.length !== length ||
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new ConsultantError("CONSULTANT_INVALID_PDF", 400);
    if (!bytes.subarray(-1024).toString("latin1").includes("%%EOF"))
      throw new ConsultantError("CONSULTANT_INVALID_PDF", 400);
    const storage = createServerSupabase().storage;
    const existing = await storage.getBucket(bucket);
    if (!existing.data) {
      const created = await storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 4_000_000,
        allowedMimeTypes: ["application/pdf"],
      });
      if (created.error && !(await storage.getBucket(bucket)).data)
        throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    } else if (existing.data.public)
      throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    const result = await storage
      .from(bucket)
      .upload(document.storageName, bytes, {
        contentType: "application/pdf",
        cacheControl: "0",
        upsert: true,
      });
    if (result.error) throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    return NextResponse.json({ success: true }, { headers: consultantHeaders });
  } catch (e) {
    return consultantFailure(e);
  }
}
