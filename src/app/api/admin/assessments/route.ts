import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { generateAssessmentProposal } from "@/lib/ai-service";
import { sendAssessmentEmail, sendProposalEmail } from "@/lib/email-service";
import { generatePDFBuffer, generateProposalPDFBuffer, AssessmentResult } from "@/lib/pdf-service";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { assessmentActionSchema, assessmentStatusUpdateSchema } from "@/lib/admin-mutation-schemas";

type AssessmentRow = {
  id: string;
  form_data: unknown;
  scores: unknown;
  category: string | null;
  ai_analysis: string | null;
  recommendations: unknown;
  overall_score: number | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

async function getAssessment(id: string) {
  const db = createServerSupabase();
  const { data, error } = await db
    .from("assessments")
    .select("id, form_data, scores, category, ai_analysis, recommendations, overall_score")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Assessment tidak ditemukan.");
  }

  return data;
}

function buildResult(row: AssessmentRow): AssessmentResult {
  const scores = parseJson<Record<string, number>>(row.scores, {});
  return {
    scores: { ...scores, overall: Number(scores.overall || row.overall_score || 0) } as AssessmentResult["scores"],
    category: row.category || "Belum dikategorikan",
    aiAnalysis: row.ai_analysis || "",
    recommendations: parseJson(row.recommendations, []),
  };
}

async function updateAssessmentWithEmailIds(
  db: ReturnType<typeof createServerSupabase>,
  id: string,
  payload: Record<string, unknown>,
  fallbackPayload: Record<string, unknown>
) {
  const { error } = await db.from("assessments").update(payload).eq("id", id);
  if (!error) return;

  const { error: fallbackError } = await db.from("assessments").update(fallbackPayload).eq("id", id);
  if (fallbackError) {
    throw fallbackError;
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, assessmentStatusUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_ASSESSMENT_STATUS");
  const { id, assessmentStatus, proposalStatus, followUpPaused } = parsed.data;

  const { data, error } = await createServerSupabase()
    .from("assessments")
    .update({
      assessment_status: assessmentStatus,
      proposal_status: proposalStatus,
      ...(followUpPaused === undefined ? {} : { follow_up_paused: followUpPaused }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, assessment: data });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, assessmentActionSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_ASSESSMENT_ACTION");
  const { id, action } = parsed.data;

  const db = createServerSupabase();

  try {
    const row = await getAssessment(id);
    const formData = parseJson<Parameters<typeof generatePDFBuffer>[0]>(row.form_data, {} as Parameters<typeof generatePDFBuffer>[0]);
    const result = buildResult(row);

    if (action === "resend_result") {
      const pdfBuffer = await generatePDFBuffer(formData, result);
      const emailIds = await sendAssessmentEmail(formData, result, pdfBuffer, id);
      const sentAt = new Date().toISOString();
      await updateAssessmentWithEmailIds(
        db,
        id,
        {
          assessment_status: "Result Email Terkirim",
          result_email_sent_at: sentAt,
          result_email_id: emailIds?.clientEmailId || null,
        },
        {
          assessment_status: "Result Email Terkirim",
          result_email_sent_at: sentAt,
        }
      );
      return NextResponse.json({ success: true });
    }

    if (action === "request_proposal") {
      const { error: requestError } = await db
        .from("assessments")
        .update({
          assessment_status: "Minta Proposal",
          proposal_status: "Diminta",
          proposal_requested_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (requestError) throw requestError;
      return NextResponse.json({ success: true });
    }

    if (action === "send_proposal") {
      const proposal = await generateAssessmentProposal({
        name: formData.name,
        email: formData.email,
        company: formData.company,
        role: formData.role,
        employees: formData.employees,
        challenge: formData.challenge,
        target: formData.target,
        category: row.category,
        overallScore: row.overall_score,
        scores: parseJson(row.scores, {}),
        aiAnalysis: row.ai_analysis,
        recommendations: parseJson(row.recommendations, []),
      });

      const proposalPdf = await generateProposalPDFBuffer(formData, proposal);
      const proposalEmail = await sendProposalEmail(formData.email, formData.name, formData.company, proposal, proposalPdf, id);
      const sentAt = new Date().toISOString();
      await updateAssessmentWithEmailIds(
        db,
        id,
        {
          assessment_status: "Proposal Terkirim",
          proposal_status: "Terkirim",
          proposal_sent_at: sentAt,
          proposal_data: proposal,
          proposal_email_id: proposalEmail.data?.id || null,
        },
        {
          assessment_status: "Proposal Terkirim",
          proposal_status: "Terkirim",
          proposal_sent_at: sentAt,
          proposal_data: proposal,
        }
      );

      return NextResponse.json({ success: true, proposal });
    }

    return adminError("Action assessment tidak dikenal.", 400, "INVALID_ASSESSMENT_ACTION");
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memproses assessment." },
      { status: 500 }
    );
  }
}
