import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { createServerSupabase } from "@/lib/supabase";
import { generateAssessmentFollowUp, generateInquiryFollowUp } from "@/lib/ai-service";
import { OutreachSuppressedError, sendOutreachEmail } from "@/lib/email-service";
import { requireAdmin } from "@/lib/admin-auth";
import { getBearerToken } from "@/lib/auth-role";
import { evaluateFollowUpWindow, followUpStopReason, followUpWindowFromEnvironment } from "@/lib/follow-up-policy";

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

const followUpLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const followUpBodySchema = z.union([
  z.object({
    inquiryId: z.string().uuid("ID inquiry tidak valid."),
    level: followUpLevelSchema,
  }).strict(),
  z.object({
    assessmentId: z.string().uuid("ID assessment tidak valid."),
    channel: z.enum(["result", "proposal"]),
    level: followUpLevelSchema,
  }).strict(),
]);

type InquiryForFollowUp = {
  id?: string;
  lead_id?: string | null;
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
  lead_id?: string | null;
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

async function loadFollowUpControl(
  db: ReturnType<typeof createServerSupabase>,
  targetType: "inquiry" | "assessment",
  targetId: string,
  leadId?: string | null,
) {
  const eventCountQuery = db
    .from("follow_up_events")
    .select("id", { count: "exact", head: true });
  const scopedEventCountQuery = leadId
    ? eventCountQuery.eq("lead_id", leadId)
    : eventCountQuery.eq("target_type", targetType).eq("target_id", targetId);
  const leadQuery = leadId
    ? db.from("leads").select("opportunity_stage").eq("id", leadId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  let bookingQuery = db
    .from("calendar_bookings")
    .select("status")
    .in("status", ["requested", "confirmed", "rescheduled"])
    .limit(1);
  if (targetType === "assessment" && leadId) {
    bookingQuery = bookingQuery.or(`assessment_id.eq.${targetId},lead_id.eq.${leadId}`);
  } else if (targetType === "assessment") {
    bookingQuery = bookingQuery.eq("assessment_id", targetId);
  } else if (leadId) {
    bookingQuery = bookingQuery.eq("lead_id", leadId);
  } else {
    bookingQuery = bookingQuery.eq("lead_id", "00000000-0000-0000-0000-000000000000");
  }

  const [events, lead, booking] = await Promise.all([scopedEventCountQuery, leadQuery, bookingQuery.maybeSingle()]);
  if (events.error) throw new Error(`Gagal membaca jumlah follow up: ${events.error.message}`);
  if (lead.error) throw new Error(`Gagal membaca opportunity lead: ${lead.error.message}`);
  if (booking.error) throw new Error(`Gagal membaca booking konsultasi: ${booking.error.message}`);
  return {
    sentCount: events.count || 0,
    opportunityStage: lead.data?.opportunity_stage || null,
    bookingStatus: booking.data?.status || null,
  };
}

class FollowUpAlreadyClaimedError extends Error {}
class FollowUpLimitReachedError extends Error {}

async function claimFollowUp(
  db: ReturnType<typeof createServerSupabase>,
  targetType: "inquiry" | "assessment",
  targetId: string,
  channel: "inquiry" | AssessmentFollowUpChannel,
  level: FollowUpLevel,
  actor: string,
  leadId?: string | null,
) {
  const { error } = await db.rpc("claim_follow_up_delivery", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_channel: channel,
    p_level: level,
    p_actor: actor,
    p_lead_id: leadId || null,
  });
  if (error?.code === "23505") {
    throw new FollowUpAlreadyClaimedError("Follow up ini sudah pernah diproses atau sedang dikirim.");
  }
  if (error?.message?.includes("MAX_FOLLOW_UP_MESSAGES_REACHED")) {
    throw new FollowUpLimitReachedError("Maksimum tiga pesan follow up untuk opportunity ini sudah tercapai.");
  }
  if (error) throw new Error(`Gagal mengunci pengiriman follow up: ${error.message}`);
}

async function updateFollowUpClaim(
  db: ReturnType<typeof createServerSupabase>,
  targetType: "inquiry" | "assessment",
  targetId: string,
  channel: "inquiry" | AssessmentFollowUpChannel,
  level: FollowUpLevel,
  payload: Record<string, unknown>,
) {
  const { error } = await db
    .from("follow_up_claims")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("channel", channel)
    .eq("level", level);
  if (error) console.error("[Follow Up] Failed to update delivery claim:", error.message);
}

async function releaseFollowUpClaim(
  db: ReturnType<typeof createServerSupabase>,
  targetType: "inquiry" | "assessment",
  targetId: string,
  channel: "inquiry" | AssessmentFollowUpChannel,
  level: FollowUpLevel,
) {
  const { error } = await db
    .from("follow_up_claims")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("channel", channel)
    .eq("level", level);
  if (error) console.error("[Follow Up] Failed to release delivery claim:", error.message);
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
  if (!inquiry.id) throw new Error("ID inquiry tidak tersedia.");
  const email = String(inquiry.email || "");
  if (!email || email === "-") {
    throw new Error("Email inquiry tidak tersedia.");
  }

  await claimFollowUp(db, "inquiry", inquiry.id, "inquiry", level, actor, inquiry.lead_id);
  let emailDelivered = false;
  let emailId: string | null = null;

  try {
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
      generated.subject,
      generated.html,
      String(inquiry.company || "")
    );
    emailDelivered = true;
    emailId = response.data?.id || null;

    const sentAt = new Date().toISOString();
    const status = FOLLOW_UP_STATUS[level];
    const entry = { type: "inquiry", level, status, actor, emailId, sentAt };
    const { error: updateError } = await db
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
    if (updateError) throw new Error(`Email terkirim tetapi status inquiry gagal disimpan: ${updateError.message}`);

    const { error: eventError } = await db.from("follow_up_events").insert({
      target_type: "inquiry",
      target_id: inquiry.id,
      lead_id: inquiry.lead_id || null,
      channel: "inquiry",
      level,
      status,
      email_id: emailId,
      actor,
      sent_at: sentAt,
      metadata: entry,
    });
    if (eventError) console.error("[Follow Up] Inquiry event log failed:", eventError.message);

    await updateFollowUpClaim(db, "inquiry", inquiry.id, "inquiry", level, { status: "sent", email_id: emailId });
    return { status, emailId };
  } catch (error) {
    if (error instanceof OutreachSuppressedError) {
      const pausedAt = new Date().toISOString();
      await db.from("inquiries").update({
        follow_up_paused: true,
        admin_notes: [
          String(inquiry.admin_notes || ""),
          `[${pausedAt}] Follow up otomatis dihentikan karena penerima unsubscribe.`,
        ].filter(Boolean).join("\n"),
      }).eq("id", inquiry.id);
      await releaseFollowUpClaim(db, "inquiry", inquiry.id, "inquiry", level);
      throw error;
    }
    if (emailDelivered) {
      await updateFollowUpClaim(db, "inquiry", inquiry.id, "inquiry", level, {
        status: "delivery_unconfirmed",
        email_id: emailId,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      await releaseFollowUpClaim(db, "inquiry", inquiry.id, "inquiry", level);
    }
    throw error;
  }
}

async function sendFollowUpForAssessment(
  db: ReturnType<typeof createServerSupabase>,
  assessment: AssessmentForFollowUp,
  channel: AssessmentFollowUpChannel,
  level: FollowUpLevel,
  actor: string
) {
  if (!assessment.id) throw new Error("ID assessment tidak tersedia.");
  const form = parseJson<Record<string, string>>(assessment.form_data, {});
  const email = String(form.email || "");
  if (!email || email === "-") {
    throw new Error("Email assessment tidak tersedia.");
  }

  await claimFollowUp(db, "assessment", assessment.id, channel, level, actor, assessment.lead_id);
  let emailDelivered = false;
  let emailId: string | null = null;

  try {
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
      generated.subject,
      generated.html,
      form.company || ""
    );
    emailDelivered = true;
    emailId = response.data?.id || null;

    const sentAt = new Date().toISOString();
    const status = `${channel === "result" ? "Result" : "Proposal"} ${FOLLOW_UP_STATUS[level]}`;
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

    const { error: updateError } = await db.from("assessments").update(payload).eq("id", assessment.id);
    if (updateError) throw new Error(`Email terkirim tetapi status assessment gagal disimpan: ${updateError.message}`);

    const { error: eventError } = await db.from("follow_up_events").insert({
      target_type: "assessment",
      target_id: assessment.id,
      lead_id: assessment.lead_id || null,
      channel,
      level,
      status,
      email_id: emailId,
      actor,
      sent_at: sentAt,
      metadata: entry,
    });
    if (eventError) console.error("[Follow Up] Assessment event log failed:", eventError.message);

    await updateFollowUpClaim(db, "assessment", assessment.id, channel, level, { status: "sent", email_id: emailId });
    return { status, emailId };
  } catch (error) {
    if (error instanceof OutreachSuppressedError) {
      const pausedAt = new Date().toISOString();
      await db.from("assessments").update({
        follow_up_paused: true,
        follow_up_history: appendHistory(assessment.follow_up_history, {
          type: "assessment",
          channel,
          level,
          status: "Unsubscribed",
          actor,
          sentAt: pausedAt,
        }),
      }).eq("id", assessment.id);
      await releaseFollowUpClaim(db, "assessment", assessment.id, channel, level);
      throw error;
    }
    if (emailDelivered) {
      await updateFollowUpClaim(db, "assessment", assessment.id, channel, level, {
        status: "delivery_unconfirmed",
        email_id: emailId,
        error: error instanceof Error ? error.message : String(error),
      });
    } else {
      await releaseFollowUpClaim(db, "assessment", assessment.id, channel, level);
    }
    throw error;
  }
}

function validateInquiryFollowUp(inquiry: InquiryForFollowUp, level: FollowUpLevel) {
  if (inquiry.follow_up_paused) return "Follow up inquiry sedang dijeda.";
  if (INQUIRY_STOP_STATUSES.has(String(inquiry.status || ""))) {
    return `Status ${inquiry.status} tidak boleh menerima follow up otomatis.`;
  }
  const expected = nextLevel(inquiry.follow_up_level);
  if (!expected) return "Seluruh level follow up inquiry sudah terkirim.";
  if (level !== expected) return `Level berikutnya harus ${expected}, bukan ${level}.`;
  return null;
}

function validateAssessmentFollowUp(
  assessment: AssessmentForFollowUp,
  channel: AssessmentFollowUpChannel,
  level: FollowUpLevel,
) {
  if (assessment.follow_up_paused) return "Follow up assessment sedang dijeda.";
  if (channel === "result") {
    if (
      RESULT_STOP_ASSESSMENT_STATUSES.has(String(assessment.assessment_status || ""))
      || RESULT_STOP_PROPOSAL_STATUSES.has(String(assessment.proposal_status || ""))
    ) {
      return "Status assessment/proposal saat ini menghentikan follow up result.";
    }
    if (!assessment.result_email_sent_at && !/Result .*Terkirim/i.test(String(assessment.assessment_status || ""))) {
      return "Email hasil assessment belum tercatat sebagai terkirim.";
    }
  } else {
    if (PROPOSAL_STOP_STATUSES.has(String(assessment.proposal_status || ""))) {
      return "Status proposal saat ini menghentikan follow up proposal.";
    }
    if (!assessment.proposal_sent_at) return "Proposal belum tercatat sebagai terkirim.";
  }

  const currentLevel = channel === "result" ? assessment.result_follow_up_level : assessment.proposal_follow_up_level;
  const expected = nextLevel(currentLevel);
  if (!expected) return `Seluruh level follow up ${channel} sudah terkirim.`;
  if (level !== expected) return `Level berikutnya harus ${expected}, bukan ${level}.`;
  return null;
}

function followUpErrorResponse(error: unknown) {
  if (error instanceof FollowUpAlreadyClaimedError) {
    return adminError(error.message, 409, "FOLLOW_UP_ALREADY_CLAIMED");
  }
  if (error instanceof FollowUpLimitReachedError) {
    return adminError(error.message, 409, "FOLLOW_UP_LIMIT_REACHED");
  }
  console.error("[Follow Up] Delivery failed:", error);
  return adminError(
    error instanceof Error ? error.message : "Gagal mengirim follow up.",
    502,
    "FOLLOW_UP_DELIVERY_FAILED",
  );
}

function followUpStopMessage(reason: ReturnType<typeof followUpStopReason>) {
  if (reason === "MAX_MESSAGES_REACHED") return "Maksimum tiga pesan follow up untuk opportunity ini sudah tercapai.";
  if (reason === "MEETING_BOOKED") return "Follow up dihentikan karena konsultasi sudah dijadwalkan.";
  if (reason === "OPPORTUNITY_ACTIVE_OR_CLOSED") return "Follow up dihentikan karena opportunity sedang ditangani atau sudah ditutup.";
  return null;
}

function followUpOpportunityKey(targetType: "inquiry" | "assessment", targetId: string, leadId?: string | null) {
  return leadId ? `lead:${leadId}` : `${targetType}:${targetId}`;
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
  const level = body.level;
  const db = createServerSupabase();

  if ("inquiryId" in body) {
    const { inquiry, error } = await loadInquiry(db, body.inquiryId);
    if (error || !inquiry) {
      return NextResponse.json({ success: false, error: error?.message || "Inquiry tidak ditemukan." }, { status: 404 });
    }
    const invalidReason = validateInquiryFollowUp(inquiry, level);
    if (invalidReason) return adminError(invalidReason, 409, "FOLLOW_UP_NOT_ALLOWED");

    try {
      const control = await loadFollowUpControl(db, "inquiry", body.inquiryId, inquiry.lead_id);
      const stopMessage = followUpStopMessage(followUpStopReason(control));
      if (stopMessage) return adminError(stopMessage, 409, "FOLLOW_UP_STOPPED");
      const result = await sendFollowUpForInquiry(db, inquiry, level, admin.email);
      return NextResponse.json({ success: true, target: "inquiry", level, ...result });
    } catch (error) {
      return followUpErrorResponse(error);
    }
  }

  if ("assessmentId" in body) {
    const { assessment, error } = await loadAssessment(db, body.assessmentId);
    if (error || !assessment) {
      return NextResponse.json({ success: false, error: error?.message || "Assessment tidak ditemukan." }, { status: 404 });
    }
    const invalidReason = validateAssessmentFollowUp(assessment, body.channel, level);
    if (invalidReason) return adminError(invalidReason, 409, "FOLLOW_UP_NOT_ALLOWED");

    try {
      const control = await loadFollowUpControl(db, "assessment", body.assessmentId, assessment.lead_id);
      const stopMessage = followUpStopMessage(followUpStopReason(control));
      if (stopMessage) return adminError(stopMessage, 409, "FOLLOW_UP_STOPPED");
      const result = await sendFollowUpForAssessment(db, assessment, body.channel, level, admin.email);
      return NextResponse.json({ success: true, target: "assessment", channel: body.channel, level, ...result });
    } catch (error) {
      return followUpErrorResponse(error);
    }
  }

  return NextResponse.json({ success: false, error: "Target follow up tidak valid." }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  const token = getBearerToken(req.headers.get("authorization"));

  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Akses cron tidak valid." }, { status: 403 });
  }

  const window = evaluateFollowUpWindow(new Date(), followUpWindowFromEnvironment());
  if (!window.allowed && process.env.FOLLOW_UP_ENFORCE_BUSINESS_WINDOW !== "false") {
    return NextResponse.json({
      success: true,
      deferred: true,
      reason: window.isHoliday ? "HOLIDAY" : "OUTSIDE_BUSINESS_WINDOW",
      localDate: window.localDate,
      localHour: window.hour,
      timeZone: window.policy.timeZone,
      window: `${window.policy.startHour}:00-${window.policy.endHour}:00`,
      sent: [],
      failures: [],
    }, { status: 202 });
  }

  const db = createServerSupabase();
  const dryRun = process.env.FOLLOW_UP_DRY_RUN === "true";
  const sent: Array<{ target: string; id?: string; channel?: AssessmentFollowUpChannel; level: FollowUpLevel; status: string; emailId: string | null }> = [];
  const candidates: Array<{ target: string; id?: string; channel?: AssessmentFollowUpChannel; level: FollowUpLevel }> = [];
  const failures: Array<{ target: string; id?: string; channel?: AssessmentFollowUpChannel; level?: FollowUpLevel; error: string }> = [];
  const dryRunReservations = new Map<string, number>();

  const { data: inquiries, error: inquiriesError } = await db.from("inquiries").select("*").order("created_at", { ascending: true }).limit(50);
  if (inquiriesError) return adminError("Gagal memuat antrean inquiry.", 500, "FOLLOW_UP_QUEUE_FAILED");
  for (const inquiry of (inquiries || []) as InquiryForFollowUp[]) {
    const level = getDueInquiryLevel(inquiry);
    if (!level) continue;
    if (sent.length + candidates.length >= 10) break;

    try {
      const targetId = String(inquiry.id || "");
      const control = await loadFollowUpControl(db, "inquiry", targetId, inquiry.lead_id);
      const reservationKey = followUpOpportunityKey("inquiry", targetId, inquiry.lead_id);
      const reserved = dryRunReservations.get(reservationKey) || 0;
      if (followUpStopReason({ ...control, sentCount: control.sentCount + reserved })) continue;
    } catch (error) {
      failures.push({ target: "inquiry", id: inquiry.id, level, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    if (dryRun) {
      candidates.push({ target: "inquiry", id: inquiry.id, level });
      const reservationKey = followUpOpportunityKey("inquiry", String(inquiry.id || ""), inquiry.lead_id);
      dryRunReservations.set(reservationKey, (dryRunReservations.get(reservationKey) || 0) + 1);
      continue;
    }

    try {
      const result = await sendFollowUpForInquiry(db, inquiry, level, "follow-up-cron");
      sent.push({ target: "inquiry", id: inquiry.id, level, ...result });
    } catch (error) {
      failures.push({ target: "inquiry", id: inquiry.id, level, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const { data: assessments, error: assessmentsError } = await db.from("assessments").select("*").order("created_at", { ascending: true }).limit(100);
  if (assessmentsError) return adminError("Gagal memuat antrean assessment.", 500, "FOLLOW_UP_QUEUE_FAILED");
  for (const assessment of (assessments || []) as AssessmentForFollowUp[]) {
    if (sent.length + candidates.length >= 20) break;

    for (const channel of ["result", "proposal"] as AssessmentFollowUpChannel[]) {
      const level = getDueAssessmentLevel(assessment, channel);
      if (!level) continue;
      if (sent.length + candidates.length >= 20) break;

      try {
        const targetId = String(assessment.id || "");
        const control = await loadFollowUpControl(db, "assessment", targetId, assessment.lead_id);
        const reservationKey = followUpOpportunityKey("assessment", targetId, assessment.lead_id);
        const reserved = dryRunReservations.get(reservationKey) || 0;
        if (followUpStopReason({ ...control, sentCount: control.sentCount + reserved })) continue;
      } catch (error) {
        failures.push({ target: "assessment", id: assessment.id, channel, level, error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      if (dryRun) {
        candidates.push({ target: "assessment", id: assessment.id, channel, level });
        const reservationKey = followUpOpportunityKey("assessment", String(assessment.id || ""), assessment.lead_id);
        dryRunReservations.set(reservationKey, (dryRunReservations.get(reservationKey) || 0) + 1);
        continue;
      }

      try {
        const result = await sendFollowUpForAssessment(db, assessment, channel, level, "follow-up-cron");
        sent.push({ target: "assessment", id: assessment.id, channel, level, ...result });
      } catch (error) {
        failures.push({ target: "assessment", id: assessment.id, channel, level, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return NextResponse.json(
    { success: failures.length === 0, dryRun, candidates, sent, failures },
    { status: failures.length ? 207 : 200 },
  );
}
