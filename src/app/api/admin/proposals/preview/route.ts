import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError } from "@/lib/admin-api";
import { generateProposalPDFBuffer, type ProposalResult } from "@/lib/pdf-service";
import { createServerSupabase } from "@/lib/supabase";
import type { AssessmentData } from "@/lib/validations";

function parseObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const assessmentId = req.nextUrl.searchParams.get("assessmentId");
  if (!assessmentId || !/^[0-9a-f-]{36}$/i.test(assessmentId)) {
    return adminError("ID assessment tidak valid.", 400, "INVALID_ASSESSMENT_ID");
  }

  const { data, error } = await createServerSupabase()
    .from("assessments")
    .select("form_data, proposal_draft_data")
    .eq("id", assessmentId)
    .single();
  if (error || !data) return adminError(error?.message || "Assessment tidak ditemukan.", 404, "ASSESSMENT_NOT_FOUND");

  const draft = parseObject(data.proposal_draft_data);
  const proposal = draft.proposal as ProposalResult | undefined;
  if (!proposal) return adminError("Draft proposal belum tersedia.", 404, "PROPOSAL_DRAFT_MISSING");
  const formData = parseObject(data.form_data) as unknown as AssessmentData;
  const pdf = await generateProposalPDFBuffer(formData, proposal);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Draft_Proposal_${assessmentId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
