import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { spinOrigin } from "@/lib/spin/http";
import {
  consultantFailure,
  consultantHeaders,
  requireConsultant,
  ConsultantError,
} from "@/lib/consultant/http";
const files: Record<string, string> = {
  "company-profile": "company-profile-binahub.pdf",
  "product-knowledge": "product-knowledge-binahub.pdf",
};
const bucket = "consultant-materials";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    await requireConsultant(req);
    const slug = (await ctx.params).slug;
    if (!Object.hasOwn(files, slug))
      throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const { data, error } = await createServerSupabase()
      .storage.from(bucket)
      .download(files[slug]);
    if (error || !data)
      throw new ConsultantError("CONSULTANT_MATERIAL_UNAVAILABLE", 404);
    return new NextResponse(data, {
      headers: {
        ...consultantHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${files[slug]}"`,
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
    if (!Object.hasOwn(files, slug))
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
      .upload(files[slug], bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (result.error) throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    return NextResponse.json({ success: true }, { headers: consultantHeaders });
  } catch (e) {
    return consultantFailure(e);
  }
}
