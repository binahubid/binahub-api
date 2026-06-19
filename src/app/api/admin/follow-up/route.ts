import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { createServerSupabase } from "@/lib/supabase";
import { generateAssessmentFollowUp, generateInquiryFollowUp } from "@/lib/ai-service";
import { sendOutreachEmail } from "@/lib/email-service";
import { requireAdmin } from "@/lib/admin-auth";

type FollowUpLevel = 1 | 2 | 3;
type AssessmentFollowUpChannel = "result" | "proposal";

const FOLLOW_UP_STATUS: Record<FollowUpLevel, string> = {
  1: "Follow Up 1 Terkirim",
  2: "Follow Up 2 Terkirim",
  3: "Follow Up 3 Terkirim",
};

const FOLLOW_UP_DAYS: Record<FollowUpLevel, number> = {
  1: 2,
  2: 7,
  3: 14,
};

const INQUIRY_STOP_STATUSES = new Set([
  "Dibalas",
  "Lanjut Diskusi",
  "Qualified",
  "Client",
  "Selesai",
  "Diarsipkan",
  "Closed",
]);

const RESULT_STOP_ASSESSMENT_STATUSES = new Set([
  "Minta Proposal",
  "Proposal Terkirim",
  "Lanjut Diskusi",
  "Closed",
]);

const RESULT_STOP_PROPOSAL_STATUSES = new Set([
  "Diminta",
  "Sedang Disusun",
  "Terkirim",
  "Revisi",
  "Lanjut Diskusi",
  "Deal",
  "Lost",
  "Closed",
]);

const PROPOSAL_STOP_STATUSES = new Set(["Revisi", "Lanjut Diskusi", "Deal", "Lost", "Closed"]);

const followUpBodySchema = z
  .object({
    inquiryId: z.string().trim().optional().default(""),
    assessmentId: z.string().trim().optional().default(""),
    channel: z.enum(["result", "proposal"]).optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.string()]).optional().default(1),
  })
  .refine((value) => Boolean(value.inquiryId || value.assessmentId), {
    message: "Target follow up tidak valid.",
  });

type InquiryForFollowUp = {
  id?: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  message?: string | null;
  status?: string | null;
  admin_notes?: string | null;
  follow_up_level?: number | null;
  follow_up_last_sent_at?: string | null;
  follow_up_history?: unknown;
  follow_up_paused?: boolean | null;
  created_at?: string | null;
};

type AssessmentForFollowUp = {
  id?: string;
  form_data?: unknown;
  category?: string | null;
  ai_analysis?: string | null;
  overall_score?: number | null;
  assessment_status?: string | null;
  proposal_status?: string | null;
  result_email_sent_at?: string | null;
  proposal_sent_at?: string | null;
  result_follow_up_level?: number | null;
  result_follow_up_sent_at?: string | null;
  result_follow_up_email_id?: string | null;
  proposal_follow_up_level?: number | null;
  proposal_follow_up_sent_at?: string | null;
  proposal_follow_up_email_id?: string | null;
  follow_up_history?: unknown;
  follow_up_paused?: boolean | null;
  created_at?: string | null;
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

function daysSince(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function normalizeLevel(value: unknown): FollowUpLevel | null {
  const level = Number(value);
  return level === 1 || level === 2 || level === 3 ? level : null;
}

function nextLevel(currentLevel?: number | null): FollowUpLevel | null {
  if (!currentLevel || currentLevel < 1) return 1;
  if (currentLevel === 1) return 2;
  if (currentLevel === 2) return 3;
  return null;
}

function appendHistory(current: unknown, entry: Record<string, unknown>) {
  const history = parseJson<Array<Record<string, unknown>>>(current, []);
  return [...(Array.isArray(history) ? history : []), entry];
}

function getDueInquiryLevel(inquiry: InquiryForFollowUp) {
  const candidate = nextLevel(inquiry.follow_up_level);
  if (!candidate) return null;
  if (inquiry.follow_up_paused) return null;

  const status = String(inquiry.status || "");
  if (INQUIRY_STOP_STATUSES.has(status) || status === FOLLOW_UP_STATUS[3]) return null;

  return daysSince(inquiry.created_at) >= FOLLOW_UP_DAYS[candidate] ? candidate : null;
}

function getAssessmentFieldPrefix(channel: AssessmentFollowUpChannel) {
  return channel === "result" ? "result" : "proposal";
}

function getDueAssessmentLevel(assessment: AssessmentForFollowUp, channel: AssessmentFollowUpChannel) {
  const currentLevel = channel === "result" ? assessment.result_follow_up_level : assessment.proposal_follow_up_level;
  const candidate = nextLevel(currentLevel);
  if (!candidate) return null;
  if (assessment.follow_up_paused) return null;

  const anchor =
    channel === "result"
      ? assessment.result_email_sent_at || assessment.created_at
      : assessment.proposal_sent_at;

  if (!anchor) return null;
  if (
    channel === "result" &&
    (RESULT_STOP_ASSESSMENT_STATUSES.has(String(assessment.assessment_status || "")) ||
      RESULT_STOP_PROPOSAL_STATUSES.has(String(assessment.proposal_status || "")))
  ) {
    return null;
  }
  if (channel === "proposal" && PROPOSAL_STOP_STATUSES.has(String(assessment.proposal_status || ""))) return null;

  return daysSince(anchor) >= FOLLOW_UP_DAYS[candidate] ? candidate : null;
}

async function loadInquiry(db: ReturnType<typeof createServerSupabase>, inquiryId: string) {
  const query = await db.from("inquiries").select("*").eq("id", inquiryId).single();
  return {
    inquiry: query.data as InquiryForFollowUp | null,
    error: query.error,
  };
}

async function loadAssessment(db: ReturnType<typeof createServerSupabase>, assessmentId: string) {
  const query = await db.from("assessments").select("*").eq("id", assessmentId).single();
  return {
    assessment: query.data as AssessmentForFollowUp | null,
    error: query.error,
  };
}

async function sendFollowUpForInquiry(
  db: ReturnType<typeof createServerSupabase>,
  inquiry: InquiryForFollowUp,
  level: FollowUpLevel,
  actor: string
) {
  const email = String(inquiry.email || "");
  if (!email || email === "-") {
    throw new Error("Email inquiry tidak tersedia.");
  }

  const generated = await generateInquiryFollowUp({
    name: String(inquiry.name || "Bapak/Ibu"),
    email,
    company: String(inquiry.company || ""),
    message: String(inquiry.message || ""),
    level,
  });

  const response = await sendOutreachEmail(
    email,
    String(inquiry.name || "Bapak/Ibu"),
    String(generated.subject || `Follow Up BinaHub ${level}`),
    String(generated.html || ""),
    String(inquiry.company || "")
  );

  const sentAt = new Date().toISOString();
  const status = FOLLOW_UP_STATUS[level];
  const emailId = response.data?.id || null;
  const entry = { type: "inquiry", level, status, actor, emailId, sentAt };

  await db
    .from("inquiries")
    .update({
      status,
      admin_notes: [String(inquiry.admin_notes || ""), `[${sentAt}] ${status} oleh ${actor}. Resend ID: ${emailId || "-"}`]
        .filter(Boolean)
        .join("\n"),
      follow_up_level: level,
      follow_up_last_sent_at: sentAt,
      follow_up_last_email_id: emailId,
      follow_up_history: appendHistory(inquiry.follow_up_history, entry),
    })
    .eq("id", inquiry.id);

  await db.from("follow_up_events").insert({
    target_type: "inquiry",
    target_id: inquiry.id,
    channel: "inquiry",
    level,
    status,
    email_id: emailId,
    actor,
    sent_at: sentAt,
    metadata: entry,
  });

  return { status, emailId };
}

async function sendFollowUpForAssessment(
  db: ReturnType<typeof createServerSupabase>,
  assessment: AssessmentForFollowUp,
  channel: AssessmentFollowUpChannel,
  level: FollowUpLevel,
  actor: string
) {
  const form = parseJson<Record<string, string>>(assessment.form_data, {});
  const email = String(form.email || "");
  if (!email || email === "-") {
    throw new Error("Email assessment tidak tersedia.");
  }

  const generated = await generateAssessmentFollowUp({
    name: form.name || "Bapak/Ibu",
    email,
    company: form.company || "",
    channel,
    level,
    category: assessment.category || "",
    overallScore: Number(assessment.overall_score || 0),
    aiAnalysis: assessment.ai_analysis || "",
    proposalStatus: assessment.proposal_status || "",
  });

  const response = await sendOutreachEmail(
    email,
    form.name || "Bapak/Ibu",
    String(generated.subject || `Follow Up ${channel === "result" ? "Result" : "Proposal"} BinaHub ${level}`),
    String(generated.html || ""),
    form.company || ""
  );

  const sentAt = new Date().toISOString();
  const status = `${channel === "result" ? "Result" : "Proposal"} ${FOLLOW_UP_STATUS[level]}`;
  const emailId = response.data?.id || null;
  const prefix = getAssessmentFieldPrefix(channel);
  const entry = { type: "assessment", channel, level, status, actor, emailId, sentAt };

  const payload =
    channel === "result"
      ? {
          assessment_status: status,
          [`${prefix}_follow_up_level`]: level,
          [`${prefix}_follow_up_sent_at`]: sentAt,
          [`${prefix}_follow_up_email_id`]: emailId,
          follow_up_history: appendHistory(assessment.follow_up_history, entry),
        }
      : {
          proposal_status: status,
          [`${prefix}_follow_up_level`]: level,
          [`${prefix}_follow_up_sent_at`]: sentAt,
          [`${prefix}_follow_up_email_id`]: emailId,
          follow_up_history: appendHistory(assessment.follow_up_history, entry),
        };

  const { error } = await db.from("assessments").update(payload).eq("id", assessment.id);
  if (error) {
    const fallbackPayload = channel === "result" ? { assessment_status: status } : { proposal_status: status };
    await db.from("assessments").update(fallbackPayload).eq("id", assessment.id);
  }

  await db.from("follow_up_events").insert({
    target_type: "assessment",
    target_id: assessment.id,
    channel,
    level,
    status,
    email_id: emailId,
    actor,
    sent_at: sentAt,
    metadata: entry,
  });

  return { status, emailId };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, followUpBodySchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_FOLLOW_UP_PAYLOAD");
  }

  const body = parsed.data;
  const level = normalizeLevel(body.level || 1);
  if (!level) {
    return adminError("Level follow up tidak valid.", 400, "INVALID_FOLLOW_UP_LEVEL");
  }

  const db = createServerSupabase();
  const inquiryId = String(body.inquiryId || "");
  const assessmentId = String(body.assessmentId || "");
  const channel = String(body.channel || "") as AssessmentFollowUpChannel;

  if (inquiryId) {
    const { inquiry, error } = await loadInquiry(db, inquiryId);
    if (error || !inquiry) {
      return NextResponse.json({ success: false, error: error?.message || "Inquiry tidak ditemukan." }, { status: 404 });
    }
    if (Number(inquiry.follow_up_level || 0) >= level) {
      return adminError(
        `Inquiry ini sudah mencapai follow up level ${inquiry.follow_up_level}.`,
        409,
        "FOLLOW_UP_ALREADY_SENT"
      );
    }

    const result = await sendFollowUpForInquiry(db, inquiry, level, admin.email);
    return NextResponse.json({ success: true, target: "inquiry", level, ...result });
  }

  if (assessmentId && (channel === "result" || channel === "proposal")) {
    const { assessment, error } = await loadAssessment(db, assessmentId);
    if (error || !assessment) {
      return NextResponse.json({ success: false, error: error?.message || "Assessment tidak ditemukan." }, { status: 404 });
    }
    const currentLevel = channel === "result" ? assessment.result_follow_up_level : assessment.proposal_follow_up_level;
    if (Number(currentLevel || 0) >= level) {
      return adminError(
        `Assessment ini sudah mencapai follow up ${channel} level ${currentLevel}.`,
        409,
        "FOLLOW_UP_ALREADY_SENT"
      );
    }

    const result = await sendFollowUpForAssessment(db, assessment, channel, level, admin.email);
    return NextResponse.json({ success: true, target: "assessment", channel, level, ...result });
  }

  return NextResponse.json({ success: false, error: "Target follow up tidak valid." }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Akses cron tidak valid." }, { status: 403 });
  }

  const db = createServerSupabase();
  const sent: Array<{ target: string; id?: string; channel?: AssessmentFollowUpChannel; level: FollowUpLevel; status: string; emailId: string | null }> = [];

  const { data: inquiries } = await db.from("inquiries").select("*").order("created_at", { ascending: true }).limit(50);
  for (const inquiry of (inquiries || []) as InquiryForFollowUp[]) {
    const level = getDueInquiryLevel(inquiry);
    if (!level) continue;
    if (sent.length >= 10) break;

    const result = await sendFollowUpForInquiry(db, inquiry, level, "follow-up-cron");
    sent.push({ target: "inquiry", id: inquiry.id, level, ...result });
  }

  const { data: assessments } = await db.from("assessments").select("*").order("created_at", { ascending: true }).limit(100);
  for (const assessment of (assessments || []) as AssessmentForFollowUp[]) {
    if (sent.length >= 20) break;

    for (const channel of ["result", "proposal"] as AssessmentFollowUpChannel[]) {
      const level = getDueAssessmentLevel(assessment, channel);
      if (!level) continue;
      if (sent.length >= 20) break;

      const result = await sendFollowUpForAssessment(db, assessment, channel, level, "follow-up-cron");
      sent.push({ target: "assessment", id: assessment.id, channel, level, ...result });
    }
  }

  return NextResponse.json({ success: true, sent });
}
