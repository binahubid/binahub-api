import { Resend } from "resend";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type DocumentType = "result-pdf" | "proposal-pdf" | "result-email" | "proposal-email";

type AssessmentDocumentRow = {
  id: string;
  result_email_id?: string | null;
  proposal_email_id?: string | null;
};

type ResendAttachment = {
  id: string;
  filename: string | null;
  size: number;
  content_type: string | null;
  download_url: string;
  expires_at: string;
};

const resend = new Resend(process.env.RESEND_API_KEY);

function getEmailId(row: AssessmentDocumentRow, type: DocumentType) {
  return type.startsWith("result") ? row.result_email_id : row.proposal_email_id;
}

function getDocumentLabel(type: DocumentType) {
  return type.startsWith("result") ? "result assessment" : "proposal";
}

function attachmentLabel(attachment: ResendAttachment) {
  const filename = attachment.filename || "Attachment";
  return filename.toLowerCase().endsWith(".pdf") ? "PDF terlampir" : "Attachment";
}

async function getAssessmentDocumentRow(id: string) {
  const db = createServerSupabase();
  const withEmailIds = await db
    .from("assessments")
    .select("id, result_email_id, proposal_email_id")
    .eq("id", id)
    .single();

  if (!withEmailIds.error) return withEmailIds.data as AssessmentDocumentRow;

  const fallback = await db
    .from("assessments")
    .select("id")
    .eq("id", id)
    .single();

  if (fallback.error || !fallback.data) {
    throw new Error("Assessment tidak ditemukan.");
  }

  return fallback.data as AssessmentDocumentRow;
}

async function listAttachments(emailId: string) {
  const { data, error } = await resend.emails.attachments.list({ emailId });
  if (error) {
    throw new Error(error.message || "Gagal mengambil attachment dari Resend.");
  }
  return (data?.data || []) as ResendAttachment[];
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const id = req.nextUrl.searchParams.get("id") || "";
  const type = (req.nextUrl.searchParams.get("type") || "") as DocumentType;
  if (!id || !["result-pdf", "proposal-pdf", "result-email", "proposal-email"].includes(type)) {
    return NextResponse.json({ success: false, error: "Parameter dokumen tidak valid." }, { status: 400 });
  }

  try {
    const row = await getAssessmentDocumentRow(id);
    const emailId = getEmailId(row, type);
    if (!emailId) {
      return NextResponse.json(
        {
          success: false,
          error: `Email ID ${getDocumentLabel(type)} belum tersimpan. Kirim ulang dokumen ini sekali agar salinan Resend bisa diakses dari dashboard.`,
        },
        { status: 404 }
      );
    }

    if (type.endsWith("email")) {
      const [{ data: email, error }, attachments] = await Promise.all([
        resend.emails.get(emailId),
        listAttachments(emailId),
      ]);

      if (error || !email) {
        throw new Error(error?.message || "Email tidak ditemukan di Resend.");
      }

      return NextResponse.json({
        success: true,
        document: {
          type,
          source: "resend",
          emailId,
          from: email.from,
          to: email.to,
          subject: email.subject,
          html: email.html || `<pre>${email.text || ""}</pre>`,
          text: email.text,
          createdAt: email.created_at,
          lastEvent: email.last_event,
          attachments: attachments.map((attachment) => ({
            id: attachment.id,
            label: attachmentLabel(attachment),
            filename: attachment.filename || "attachment",
            size: attachment.size,
            contentType: attachment.content_type,
            expiresAt: attachment.expires_at,
          })),
        },
      });
    }

    const attachments = await listAttachments(emailId);
    const pdfAttachment =
      attachments.find((attachment) => attachment.content_type === "application/pdf") ||
      attachments.find((attachment) => (attachment.filename || "").toLowerCase().endsWith(".pdf"));

    if (!pdfAttachment) {
      return NextResponse.json({ success: false, error: "PDF attachment tidak ditemukan di email Resend." }, { status: 404 });
    }

    const pdfResponse = await fetch(pdfAttachment.download_url);
    if (!pdfResponse.ok) {
      throw new Error("Gagal mengunduh PDF dari signed URL Resend.");
    }

    const pdf = await pdfResponse.arrayBuffer();
    return new NextResponse(pdf, {
      headers: {
        "content-type": pdfAttachment.content_type || "application/pdf",
        "content-disposition": `attachment; filename="${pdfAttachment.filename || "BinaHub_Document.pdf"}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal mengambil dokumen dari Resend." },
      { status: 500 }
    );
  }
}
