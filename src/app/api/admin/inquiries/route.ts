import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { inquiryReplyActionSchema, inquiryUpdateSchema } from "@/lib/admin-mutation-schemas";
import { generateInquiryReplyDraft } from "@/lib/ai-service";
import { sendReviewedInquiryReply } from "@/lib/email-service";

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, inquiryUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_INQUIRY_UPDATE");
  const { id, status, notes, followUpPaused } = parsed.data;

  const { data, error } = await createServerSupabase()
    .from("inquiries")
    .update({
      status,
      admin_notes: notes,
      ...(followUpPaused === undefined ? {} : { follow_up_paused: followUpPaused }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, inquiry: data });
}

type InquiryReplyRow = {
  id: string;
  lead_id?: string | null;
  name: string;
  email: string;
  message?: string | null;
  module_request_data?: unknown;
  reply_subject?: string | null;
  reply_body?: string | null;
  reply_status?: string | null;
  reply_sent_at?: string | null;
};

function moduleSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const modules = (value as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) return "";
  return modules
    .map((item) => item && typeof item === "object" ? String((item as { name?: unknown; code?: unknown }).name || (item as { code?: unknown }).code || "") : "")
    .filter(Boolean)
    .slice(0, 20)
    .join(", ");
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }
  const parsed = await parseValidatedBody(req, inquiryReplyActionSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_INQUIRY_REPLY_ACTION");

  const db = createServerSupabase();
  const { data, error } = await db.from("inquiries").select("*").eq("id", parsed.data.id).single();
  if (error || !data) return adminError(error?.message || "Inquiry tidak ditemukan.", 404, "INQUIRY_NOT_FOUND");
  const inquiry = data as InquiryReplyRow;

  if (parsed.data.action === "generate_reply_draft") {
    let company = "";
    if (inquiry.lead_id) {
      const lead = await db.from("leads").select("company").eq("id", inquiry.lead_id).maybeSingle();
      company = String(lead.data?.company || "");
    }
    try {
      const draft = await generateInquiryReplyDraft({
        name: inquiry.name,
        email: inquiry.email,
        company,
        message: String(inquiry.message || ""),
        moduleSummary: moduleSummary(inquiry.module_request_data),
      });
      const generatedAt = new Date().toISOString();
      const updated = await db.from("inquiries").update({
        reply_subject: draft.subject,
        reply_body: draft.body,
        reply_status: "draft",
        reply_generated_at: generatedAt,
        reply_generated_by: admin.email,
        reply_reviewed_at: null,
        reply_reviewed_by: null,
      }).eq("id", inquiry.id).select().single();
      if (updated.error) throw new Error(updated.error.message);
      await logAdminEvent(db, {
        eventType: "inquiry_reply_draft_generated", targetType: "inquiry", targetId: inquiry.id,
        actor: admin.email, status: "Draft", message: "Draf AI dibuat; belum dikirim.",
      });
      return NextResponse.json({ success: true, draft: { subject: draft.subject, body: draft.body, status: "draft", generatedAt } });
    } catch (draftError) {
      return adminError(draftError instanceof Error ? draftError.message : "Gagal membuat draf balasan.", 502, "INQUIRY_REPLY_DRAFT_FAILED");
    }
  }

  if (parsed.data.action === "save_reply_review") {
    if (inquiry.reply_status === "sent") return adminError("Balasan inquiry ini sudah dikirim.", 409, "INQUIRY_REPLY_ALREADY_SENT");
    const reviewedAt = new Date().toISOString();
    const updated = await db.from("inquiries").update({
      reply_subject: parsed.data.subject,
      reply_body: parsed.data.body,
      reply_status: "reviewed",
      reply_reviewed_at: reviewedAt,
      reply_reviewed_by: admin.email,
    }).eq("id", inquiry.id).select().single();
    if (updated.error) return adminError(updated.error.message, 500, "INQUIRY_REPLY_REVIEW_SAVE_FAILED");
    await logAdminEvent(db, {
      eventType: "inquiry_reply_reviewed", targetType: "inquiry", targetId: inquiry.id,
      actor: admin.email, status: "Reviewed", message: "Draf balasan inquiry telah direview manusia.",
    });
    return NextResponse.json({ success: true, status: "reviewed", reviewedAt });
  }

  if (inquiry.reply_status === "sent" || inquiry.reply_sent_at) {
    return adminError("Balasan inquiry ini sudah dikirim.", 409, "INQUIRY_REPLY_ALREADY_SENT");
  }
  if (inquiry.reply_status !== "reviewed" || !inquiry.reply_subject || !inquiry.reply_body) {
    return adminError("Draf harus disimpan sebagai hasil review manusia sebelum dikirim.", 409, "HUMAN_REVIEW_REQUIRED");
  }
  const claim = await db.from("inquiries")
    .update({ reply_status: "sending" })
    .eq("id", inquiry.id)
    .eq("reply_status", "reviewed")
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) {
    return adminError("Balasan sedang diproses atau status review telah berubah.", 409, "INQUIRY_REPLY_ALREADY_CLAIMED");
  }
  try {
    const response = await sendReviewedInquiryReply({
      to: inquiry.email,
      name: inquiry.name,
      subject: inquiry.reply_subject,
      body: inquiry.reply_body,
    });
    const sentAt = new Date().toISOString();
    const emailId = response.data?.id || null;
    const updated = await db.from("inquiries").update({
      reply_status: "sent",
      reply_sent_at: sentAt,
      reply_email_id: emailId,
      status: "Dibalas",
      follow_up_paused: true,
    }).eq("id", inquiry.id).eq("reply_status", "sending").select("id").maybeSingle();
    if (updated.error || !updated.data) {
      return adminError("Email terkirim tetapi status pengiriman perlu direkonsiliasi.", 500, "INQUIRY_REPLY_RECONCILIATION_REQUIRED");
    }
    await logAdminEvent(db, {
      eventType: "inquiry_reply_sent", targetType: "inquiry", targetId: inquiry.id,
      actor: admin.email, status: "Sent", message: "Balasan inquiry yang telah direview manusia dikirim.",
      payload: { emailId },
    });
    return NextResponse.json({ success: true, status: "sent", sentAt, emailId });
  } catch (sendError) {
    await db.from("inquiries").update({ reply_status: "reviewed" }).eq("id", inquiry.id).eq("reply_status", "sending");
    return adminError(sendError instanceof Error ? sendError.message : "Gagal mengirim balasan inquiry.", 502, "INQUIRY_REPLY_SEND_FAILED");
  }
}
