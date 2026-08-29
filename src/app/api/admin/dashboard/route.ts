import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const DIMENSIONS = ["Insights", "Lab", "Coach", "Play", "Academy", "Works", "Impact"] as const;

type Dimension = (typeof DIMENSIONS)[number];

type Scores = Record<Dimension, number> & { overall: number };

type Recommendation = {
  title?: string;
  service?: string;
  priority?: string;
  description?: string;
};

type FormData = {
  name?: string;
  email?: string;
  company?: string;
  role?: string;
  whatsapp?: string;
  employees?: string;
  industry?: string;
  location?: string;
  timeline?: string;
  budgetStatus?: string;
  sponsorStatus?: string;
  nextStepIntent?: string;
  businessConsequence?: string;
  source?: string;
  challenge?: string;
  target?: string;
  answers?: Record<string, number>;
  attribution?: Record<string, string>;
};

type AssessmentRow = {
  id: string;
  lead_id: string | null;
  form_data: unknown;
  scores: unknown;
  category: string | null;
  ai_analysis: string | null;
  recommendations: unknown;
  overall_score: number | null;
  assessment_status?: string | null;
  result_email_sent_at?: string | null;
  result_email_id?: string | null;
  proposal_status?: string | null;
  proposal_sent_at?: string | null;
  proposal_email_id?: string | null;
  proposal_requested_at?: string | null;
  result_follow_up_level?: number | null;
  result_follow_up_sent_at?: string | null;
  result_follow_up_email_id?: string | null;
  proposal_follow_up_level?: number | null;
  proposal_follow_up_sent_at?: string | null;
  proposal_follow_up_email_id?: string | null;
  follow_up_history?: unknown;
  follow_up_paused?: boolean | null;
  proposal_data?: unknown;
  proposal_draft_data?: unknown;
  proposal_gate_status?: string | null;
  proposal_gate_reasons?: unknown;
  proposal_catalog_version?: string | null;
  proposal_generated_at?: string | null;
  proposal_approved_at?: string | null;
  proposal_approved_by?: string | null;
  created_at: string;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  industry?: string | null;
  location?: string | null;
  qualification_profile?: unknown;
  phone: string | null;
  source: string | null;
  lead_score: number | null;
  lead_status: string | null;
  lead_temperature?: string | null;
  lead_score_confidence?: number | null;
  lead_score_reason?: string | null;
  lead_score_evidence?: unknown;
  lead_score_rule_version?: string | null;
  lifecycle_stage?: string | null;
  opportunity_stage?: string | null;
  opportunity_owner?: string | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
  lead_time_zone?: string | null;
  opportunity_value?: number | null;
  lost_reason?: string | null;
  won_at?: string | null;
  lost_at?: string | null;
  outreach_paused?: boolean | null;
  outreach_pause_reason?: string | null;
  outreach_paused_at?: string | null;
  outreach_paused_by?: string | null;
  pipeline_updated_at?: string | null;
  source_metadata?: unknown;
  notes: string | null;
  created_at: string | null;
};

type InquiryRow = {
  id: string;
  lead_id?: string | null;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  message: string | null;
  source?: string | null;
  status?: string | null;
  admin_notes?: string | null;
  module_request_data?: unknown;
  follow_up_level?: number | null;
  follow_up_last_sent_at?: string | null;
  follow_up_paused?: boolean | null;
  created_at: string | null;
};

type OpportunityActivityRow = {
  id: string;
  lead_id: string;
  assessment_id?: string | null;
  inquiry_id?: string | null;
  event_type: string;
  from_stage?: string | null;
  to_stage?: string | null;
  actor: string;
  note?: string | null;
  metadata?: unknown;
  created_at: string;
};

type EmailDeliveryEventRow = {
  id: string;
  email_id?: string | null;
  event_type: string;
  recipient_email?: string | null;
  sender_email?: string | null;
  subject?: string | null;
  processing_status: string;
  error_message?: string | null;
  provider_created_at?: string | null;
  received_at: string;
};

type CalendarBookingRow = {
  id: string;
  provider_uid: string;
  lead_id?: string | null;
  assessment_id?: string | null;
  event_type_slug?: string | null;
  title?: string | null;
  status: string;
  attendee_name?: string | null;
  attendee_email?: string | null;
  organizer_email?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  time_zone?: string | null;
  meeting_url?: string | null;
  cancellation_reason?: string | null;
  updated_at?: string | null;
};

type CoachRow = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  expertise?: string;
  field?: string;
  status?: string;
  bio?: string;
  category?: string;
  rate?: string;
  availability?: string;
  cv_url?: string;
  linkedin_url?: string;
  linkedin_summary?: string;
  notes?: string;
  created_at?: string;
};

type EmployeeRow = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
  status?: string;
  notes?: string;
  created_at?: string;
};

type CoachAssignmentRow = {
  id?: string;
  coach_id?: string;
  client_name?: string;
  program_name?: string;
  service?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  notes?: string;
  created_at?: string;
};

type CoachSessionRow = {
  id?: string;
  coach_id?: string;
  assignment_id?: string;
  session_date?: string;
  duration_minutes?: number;
  topic?: string;
  rating?: number;
  evaluation?: string;
  notes?: string;
  created_at?: string;
};

type CoachAvailabilityRow = {
  id?: string;
  coach_id?: string;
  day_of_week?: string;
  time_window?: string;
  mode?: string;
  status?: string;
  notes?: string;
  created_at?: string;
};

type CoachDocumentRow = {
  id?: string;
  coach_id?: string;
  title?: string;
  document_type?: string;
  document_url?: string;
  status?: string;
  expiry_date?: string;
  notes?: string;
  created_at?: string;
};

type ProjectRow = {
  id?: string;
  client_name?: string;
  contact_name?: string;
  contact_email?: string;
  service?: string;
  program_name?: string;
  project_type?: string;
  scope?: string;
  budget_note?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  ai_summary?: string;
  automation_mode?: string;
  created_at?: string;
};

type ProjectAssignmentSmartRow = {
  id?: string;
  project_id?: string;
  associate_id?: string;
  associate_name?: string;
  associate_email?: string;
  role_title?: string;
  status?: string;
  match_score?: number;
  match_reason?: string;
  invitation_sent_at?: string;
  created_at?: string;
};

type SmartActionRow = {
  id?: string;
  action_type?: string;
  title?: string;
  description?: string;
  target_type?: string;
  target_id?: string;
  priority?: string;
  status?: string;
  mode?: string;
  due_at?: string;
  created_at?: string;
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

function normalizeScore(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
}

function getScores(value: unknown, overallScore?: number | null): Scores {
  const parsed = parseJson<Partial<Scores>>(value, {});
  const scores = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, normalizeScore(parsed[dimension])])
  ) as Record<Dimension, number>;

  return {
    ...scores,
    overall: normalizeScore(parsed.overall ?? overallScore),
  };
}

function getRecommendations(value: unknown): Recommendation[] {
  const parsed = parseJson<Recommendation[]>(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function getFormData(value: unknown): FormData {
  return parseJson<FormData>(value, {});
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = value || "Tidak diketahui";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildAnswerDistribution(records: Array<{ answers: Record<string, number> }>) {
  return Array.from({ length: 49 }, (_, index) => {
    const question = `Q${index + 1}`;
    const counts = { question, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };

    records.forEach((record) => {
      const answer = record.answers[String(index + 1)];
      if (answer >= 1 && answer <= 5) {
        counts[String(answer) as "1" | "2" | "3" | "4" | "5"] += 1;
      }
    });

    return counts;
  });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const db = createServerSupabase();

  const assessmentSelect =
    "id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, assessment_status, result_email_sent_at, result_email_id, proposal_status, proposal_sent_at, proposal_email_id, proposal_requested_at, result_follow_up_level, result_follow_up_sent_at, result_follow_up_email_id, proposal_follow_up_level, proposal_follow_up_sent_at, proposal_follow_up_email_id, follow_up_history, follow_up_paused, proposal_data, proposal_draft_data, proposal_gate_status, proposal_gate_reasons, proposal_catalog_version, proposal_generated_at, proposal_approved_at, proposal_approved_by, created_at";

  const assessmentSelectWithoutEmailIds =
    "id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, assessment_status, result_email_sent_at, proposal_status, proposal_sent_at, proposal_requested_at, proposal_data, created_at";

  const assessmentQuery = await db
    .from("assessments")
    .select(assessmentSelect)
    .order("created_at", { ascending: false });

  const fallbackAssessmentQuery = assessmentQuery.error
    ? await db
        .from("assessments")
        .select(assessmentSelectWithoutEmailIds)
        .order("created_at", { ascending: false })
    : assessmentQuery;

  const finalAssessmentQuery = fallbackAssessmentQuery.error
    ? await db
        .from("assessments")
        .select("id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, created_at")
        .order("created_at", { ascending: false })
    : fallbackAssessmentQuery;

  const [leadQuery, inquiryQuery] = await Promise.all([
      db
        .from("leads")
        .select("id, name, email, company, industry, location, qualification_profile, phone, source, lead_score, lead_status, lead_temperature, lead_score_confidence, lead_score_reason, lead_score_evidence, lead_score_rule_version, lifecycle_stage, opportunity_stage, opportunity_owner, next_action, next_action_due_at, lead_time_zone, opportunity_value, lost_reason, won_at, lost_at, outreach_paused, outreach_pause_reason, outreach_paused_at, outreach_paused_by, pipeline_updated_at, source_metadata, notes, created_at")
        .order("created_at", { ascending: false }),
      db
        .from("inquiries")
        .select("id, lead_id, name, email, whatsapp, message, source, status, admin_notes, module_request_data, follow_up_level, follow_up_last_sent_at, follow_up_paused, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const fallbackLeadQuery = leadQuery.error
    ? await db
        .from("leads")
        .select("id, name, email, company, phone, source, lead_score, lead_status, notes, created_at")
        .order("created_at", { ascending: false })
    : leadQuery;
  const fallbackInquiryQuery = inquiryQuery.error
    ? await db
        .from("inquiries")
        .select("id, lead_id, name, email, whatsapp, message, source, status, admin_notes, follow_up_level, follow_up_last_sent_at, follow_up_paused, created_at")
        .order("created_at", { ascending: false })
        .limit(100)
    : inquiryQuery;
  const leadRows = fallbackLeadQuery.data;
  const inquiryRows = fallbackInquiryQuery.data;

  const assessmentRows = finalAssessmentQuery.data;
  const assessmentError = finalAssessmentQuery.error;

  if (assessmentError) {
    return NextResponse.json(
      { success: false, error: assessmentError.message },
      { status: 500 }
    );
  }

  let coachRows: CoachRow[] = [];
  try {
    const { data } = await db
      .from("coaches")
      .select("*")
      .order("created_at", { ascending: false });
    coachRows = (data || []) as CoachRow[];
  } catch {
    coachRows = [];
  }

  let employeeRows: EmployeeRow[] = [];
  try {
    const { data } = await db
      .from("employees")
      .select("id, name, email, phone, role, department, status, notes, created_at")
      .order("created_at", { ascending: false });
    employeeRows = (data || []) as EmployeeRow[];
  } catch {
    employeeRows = [];
  }

  let assignmentRows: CoachAssignmentRow[] = [];
  try {
    const { data } = await db
      .from("coach_assignments")
      .select("id, coach_id, client_name, program_name, service, status, start_date, end_date, notes, created_at")
      .order("created_at", { ascending: false });
    assignmentRows = (data || []) as CoachAssignmentRow[];
  } catch {
    assignmentRows = [];
  }

  let sessionRows: CoachSessionRow[] = [];
  try {
    const { data } = await db
      .from("coach_sessions")
      .select("id, coach_id, assignment_id, session_date, duration_minutes, topic, rating, evaluation, notes, created_at")
      .order("session_date", { ascending: false });
    sessionRows = (data || []) as CoachSessionRow[];
  } catch {
    sessionRows = [];
  }

  let availabilityRows: CoachAvailabilityRow[] = [];
  try {
    const { data } = await db
      .from("coach_availability")
      .select("id, coach_id, day_of_week, time_window, mode, status, notes, created_at")
      .order("created_at", { ascending: false });
    availabilityRows = (data || []) as CoachAvailabilityRow[];
  } catch {
    availabilityRows = [];
  }

  let documentRows: CoachDocumentRow[] = [];
  try {
    const { data } = await db
      .from("coach_documents")
      .select("id, coach_id, title, document_type, document_url, status, expiry_date, notes, created_at")
      .order("created_at", { ascending: false });
    documentRows = (data || []) as CoachDocumentRow[];
  } catch {
    documentRows = [];
  }

  let projectRows: ProjectRow[] = [];
  let projectAssignmentRows: ProjectAssignmentSmartRow[] = [];
  let smartActionRows: SmartActionRow[] = [];
  try {
    const [{ data: projects }, { data: projectAssignments }, { data: smartActions }] = await Promise.all([
      db.from("projects").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("project_assignments").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("smart_actions").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    projectRows = (projects || []) as ProjectRow[];
    projectAssignmentRows = (projectAssignments || []) as ProjectAssignmentSmartRow[];
    smartActionRows = (smartActions || []) as SmartActionRow[];
  } catch {
    projectRows = [];
    projectAssignmentRows = [];
    smartActionRows = [];
  }

  let calendarBookingRows: CalendarBookingRow[] = [];
  try {
    const { data } = await db
      .from("calendar_bookings")
      .select("id, provider_uid, lead_id, assessment_id, event_type_slug, title, status, attendee_name, attendee_email, organizer_email, start_time, end_time, time_zone, meeting_url, cancellation_reason, updated_at")
      .order("start_time", { ascending: true })
      .limit(200);
    calendarBookingRows = (data || []) as CalendarBookingRow[];
  } catch {
    calendarBookingRows = [];
  }

  let opportunityActivityRows: OpportunityActivityRow[] = [];
  let emailDeliveryEventRows: EmailDeliveryEventRow[] = [];
  try {
    const [{ data: activities }, { data: emailEvents }] = await Promise.all([
      db.from("opportunity_activities")
        .select("id, lead_id, assessment_id, inquiry_id, event_type, from_stage, to_stage, actor, note, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("email_delivery_events")
        .select("id, email_id, event_type, recipient_email, sender_email, subject, processing_status, error_message, provider_created_at, received_at")
        .order("received_at", { ascending: false })
        .limit(500),
    ]);
    opportunityActivityRows = (activities || []) as OpportunityActivityRow[];
    emailDeliveryEventRows = (emailEvents || []) as EmailDeliveryEventRow[];
  } catch {
    opportunityActivityRows = [];
    emailDeliveryEventRows = [];
  }

  const leadsById = new Map((leadRows || []).map((lead) => [lead.id, lead as LeadRow]));

  const assessments = ((assessmentRows || []) as AssessmentRow[]).map((row) => {
    const form = getFormData(row.form_data);
    const lead = row.lead_id ? leadsById.get(row.lead_id) : undefined;
    const scores = getScores(row.scores, row.overall_score);
    const recommendations = getRecommendations(row.recommendations);

    return {
      id: row.id,
      leadId: row.lead_id,
      name: form.name || lead?.name || "-",
      email: form.email || lead?.email || "-",
      company: form.company || lead?.company || "-",
      role: form.role || "-",
      whatsapp: form.whatsapp || lead?.phone || "",
      employees: form.employees || "Tidak diketahui",
      industry: form.industry || lead?.industry || "",
      location: form.location || lead?.location || "",
      timeline: form.timeline || "unknown",
      budgetStatus: form.budgetStatus || "unknown",
      sponsorStatus: form.sponsorStatus || "unknown",
      nextStepIntent: form.nextStepIntent || "explore",
      businessConsequence: form.businessConsequence || "",
      source: form.source || lead?.source || "insight_assessment",
      challenge: form.challenge || "",
      target: form.target || "",
      scores,
      category: row.category || "Tidak diketahui",
      aiAnalysis: row.ai_analysis || "",
      recommendations,
      answers: form.answers || {},
      overallScore: scores.overall,
      assessmentStatus: row.assessment_status || (row.result_email_sent_at ? "Result Email Terkirim" : "Result Otomatis Terkirim"),
      resultEmailSentAt: row.result_email_sent_at || null,
      resultEmailId: row.result_email_id || null,
      proposalStatus: row.proposal_status || "Belum Diminta",
      proposalRequestedAt: row.proposal_requested_at || null,
      proposalSentAt: row.proposal_sent_at || null,
      proposalEmailId: row.proposal_email_id || null,
      proposalDraft: row.proposal_draft_data || null,
      proposalGateStatus: row.proposal_gate_status || "not_evaluated",
      proposalGateReasons: Array.isArray(row.proposal_gate_reasons) ? row.proposal_gate_reasons : [],
      proposalCatalogVersion: row.proposal_catalog_version || null,
      proposalGeneratedAt: row.proposal_generated_at || null,
      proposalApprovedAt: row.proposal_approved_at || null,
      proposalApprovedBy: row.proposal_approved_by || null,
      resultFollowUpLevel: row.result_follow_up_level || 0,
      resultFollowUpSentAt: row.result_follow_up_sent_at || null,
      proposalFollowUpLevel: row.proposal_follow_up_level || 0,
      proposalFollowUpSentAt: row.proposal_follow_up_sent_at || null,
      followUpPaused: row.follow_up_paused === true,
      leadScore: lead?.lead_score || null,
      leadStatus: lead?.lead_status || null,
      leadTemperature: lead?.lead_temperature || lead?.lead_status || null,
      leadScoreConfidence: lead?.lead_score_confidence ?? null,
      leadScoreReason: lead?.lead_score_reason || null,
      leadScoreEvidence: lead?.lead_score_evidence || null,
      leadScoreRuleVersion: lead?.lead_score_rule_version || null,
      lifecycleStage: lead?.lifecycle_stage || "prospect",
      opportunityStage: lead?.opportunity_stage || "identified",
      attribution: form.attribution || (lead?.source_metadata as Record<string, string> | undefined) || {},
      createdAt: row.created_at,
    };
  });

  const dimensionStats = DIMENSIONS.map((dimension) => {
    const values = assessments.map((assessment) => assessment.scores[dimension]);
    return {
      dimension,
      average: Math.round(average(values)),
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  });

  const strongestDimension = dimensionStats.reduce(
    (best, item) => (item.average > best.average ? item : best),
    dimensionStats[0]
  );
  const weakestDimension = dimensionStats.reduce(
    (weakest, item) => (item.average < weakest.average ? item : weakest),
    dimensionStats[0]
  );

  const categoryBreakdown = Object.entries(countBy(assessments.map((item) => item.category))).map(
    ([category, count]) => ({ category, count })
  );

  const employeeStats = Object.entries(countBy(assessments.map((item) => item.employees))).map(
    ([range, count]) => {
      const records = assessments.filter((item) => item.employees === range);
      return { range, count, avgOverall: Math.round(average(records.map((item) => item.overallScore))) };
    }
  );

  const recommendationCounts = assessments
    .flatMap((assessment) => assessment.recommendations.map((rec) => rec.service || "Tidak diketahui"))
    .reduce<Record<string, number>>((acc, service) => {
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {});

  const topRecommendations = Object.entries(recommendationCounts)
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count);

  type ContactItem = {
    id: string;
    recordId: string;
    name: string;
    email: string;
    whatsapp: string;
    message: string;
    source: string;
    sourceType: string;
    category: string;
    status: string;
    notes: string;
    createdAt: string | null;
  };

  const contactMap = new Map<string, ContactItem>();

  const contactKey = (item: Pick<ContactItem, "email" | "whatsapp" | "sourceType" | "recordId">) => {
    const email = item.email && item.email !== "-" ? item.email.toLowerCase() : "";
    const phone = item.whatsapp ? item.whatsapp.replace(/\D/g, "") : "";
    return email || phone || `${item.sourceType}:${item.recordId}`;
  };

  const mergeContact = (item: ContactItem) => {
    const key = contactKey(item);
    const current = contactMap.get(key);

    if (!current) {
      contactMap.set(key, item);
      return;
    }

    const currentDate = new Date(current.createdAt || 0).getTime();
    const itemDate = new Date(item.createdAt || 0).getTime();
    const primary = current.sourceType === "lead" ? current : item.sourceType === "lead" ? item : itemDate > currentDate ? item : current;
    const secondary = primary === current ? item : current;

    contactMap.set(key, {
      ...primary,
      id: primary.id,
      recordId: primary.recordId,
      name: primary.name !== "-" ? primary.name : secondary.name,
      email: primary.email !== "-" ? primary.email : secondary.email,
      whatsapp: primary.whatsapp || secondary.whatsapp,
      message: [primary.message, secondary.message].filter(Boolean).find((value) => value && value !== primary.notes) || primary.message || secondary.message,
      source: Array.from(new Set([primary.source, secondary.source].filter(Boolean))).join(" + "),
      sourceType: primary.sourceType,
      category: Array.from(new Set([primary.category, secondary.category].filter(Boolean))).join(" + "),
      status: primary.status || secondary.status,
      notes: primary.notes || secondary.notes,
      createdAt: new Date(Math.max(currentDate, itemDate)).toISOString(),
    });
  };

  ((leadRows || []) as LeadRow[]).forEach((lead) => {
    mergeContact({
      id: `lead:${lead.id}`,
      recordId: lead.id,
      name: lead.name || "-",
      email: lead.email || "-",
      whatsapp: lead.phone || "",
      message: lead.notes || "",
      source: lead.source || "lead",
      sourceType: "lead",
      category:
        lead.source === "insight_assessment"
          ? "Klien Assessment"
          : lead.source === "contact_form"
            ? "Klien Inquiry"
            : "Lead",
      status: lead.lead_status || "New Lead",
      notes: lead.notes || "",
      createdAt: lead.created_at,
    });
  });

  ((inquiryRows || []) as InquiryRow[]).forEach((item) => {
    mergeContact({
      id: `inquiry:${item.id}`,
      recordId: item.id,
      name: item.name || "-",
      email: item.email || "-",
      whatsapp: item.whatsapp || "",
      message: item.message || "",
      source: item.source || "contact_form",
      sourceType: "inquiry",
      category: "Inquiry",
      status: item.status || "Baru",
      notes: item.admin_notes || "",
      createdAt: item.created_at,
    });
  });

  const normalizedCoaches = coachRows.map((coach) => ({
    ...coach,
    cvUrl: coach.cv_url || "",
    linkedinUrl: coach.linkedin_url || "",
    linkedinSummary: coach.linkedin_summary || "",
  }));

  normalizedCoaches.forEach((coach) => {
    mergeContact({
      id: `coach:${coach.id}`,
      recordId: coach.id || "",
      name: coach.name || "Coach BinaHub",
      email: coach.email || "-",
      whatsapp: coach.phone || "",
      message: coach.notes || coach.bio || coach.linkedinSummary || "",
      source: "coach",
      sourceType: "coach",
      category: coach.category || "Coach",
      status: coach.status || "active",
      notes: coach.notes || "",
      createdAt: coach.created_at || null,
    });
  });

  employeeRows.forEach((employee) => {
    mergeContact({
      id: `employee:${employee.id}`,
      recordId: employee.id || "",
      name: employee.name || "Karyawan BinaHub",
      email: employee.email || "-",
      whatsapp: employee.phone || "",
      message: employee.notes || "",
      source: "employee",
      sourceType: "employee",
      category: employee.department || employee.role || "Karyawan",
      status: employee.status || "active",
      notes: employee.notes || "",
      createdAt: employee.created_at || null,
    });
  });

  const contacts = Array.from(contactMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  const inquiries = ((inquiryRows || []) as InquiryRow[])
    .map((item) => ({
      id: item.id,
      name: item.name || "-",
      email: item.email || "-",
      whatsapp: item.whatsapp || "",
      message: item.message || "",
      source: item.source || "contact_form",
      status: item.status || "Baru",
      notes: item.admin_notes || "",
      followUpLevel: item.follow_up_level || 0,
      followUpLastSentAt: item.follow_up_last_sent_at || null,
      followUpPaused: item.follow_up_paused === true,
      moduleRequest: parseJson<Record<string, unknown>>(item.module_request_data, {}),
      createdAt: item.created_at,
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const pipelineLeads = ((leadRows || []) as LeadRow[]).map((lead) => ({
    id: lead.id,
    name: lead.name || "-",
    email: lead.email || "-",
    company: lead.company || "-",
    industry: lead.industry || null,
    location: lead.location || null,
    qualificationProfile: parseJson<Record<string, unknown>>(lead.qualification_profile, {}),
    phone: lead.phone || "",
    source: lead.source || "lead",
    leadScore: lead.lead_score ?? null,
    leadTemperature: lead.lead_temperature || lead.lead_status || "unclassified",
    leadScoreConfidence: lead.lead_score_confidence ?? null,
    lifecycleStage: lead.lifecycle_stage || "prospect",
    opportunityStage: lead.opportunity_stage || "identified",
    opportunityOwner: lead.opportunity_owner || null,
    nextAction: lead.next_action || null,
    nextActionDueAt: lead.next_action_due_at || null,
    leadTimeZone: lead.lead_time_zone || "Asia/Jakarta",
    opportunityValue: lead.opportunity_value ?? null,
    lostReason: lead.lost_reason || null,
    wonAt: lead.won_at || null,
    lostAt: lead.lost_at || null,
    outreachPaused: lead.outreach_paused === true,
    outreachPauseReason: lead.outreach_pause_reason || null,
    outreachPausedAt: lead.outreach_paused_at || null,
    outreachPausedBy: lead.outreach_paused_by || null,
    pipelineUpdatedAt: lead.pipeline_updated_at || lead.created_at,
    createdAt: lead.created_at,
  }));
  const activePipelineLeads = pipelineLeads.filter((lead) => !["won", "lost"].includes(lead.opportunityStage));
  const now = Date.now();
  const deliverabilityEvents = new Set(["email.bounced", "email.complained", "email.failed", "email.suppressed"]);
  const emailDeliverySummary = emailDeliveryEventRows.reduce((summary, item) => {
    summary.total += 1;
    if (item.event_type === "email.delivered") summary.delivered += 1;
    if (item.event_type === "email.bounced") summary.bounced += 1;
    if (item.event_type === "email.complained") summary.complained += 1;
    if (item.event_type === "email.failed") summary.failed += 1;
    if (item.event_type === "email.received") summary.received += 1;
    if (item.processing_status === "failed") summary.processingFailed += 1;
    return summary;
  }, { total: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, received: 0, processingFailed: 0 });

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalAssessments: assessments.length,
      avgOverall: Math.round(average(assessments.map((item) => item.overallScore))),
      strongestDimension,
      weakestDimension,
      mostCommonCategory: categoryBreakdown.sort((a, b) => b.count - a.count)[0]?.category || "-",
      totalContacts: contacts.length,
      totalInquiries: inquiries.length,
      totalCoaches: normalizedCoaches.length,
      totalEmployees: employeeRows.length,
      upcomingMeetings: calendarBookingRows.filter((item) =>
        ["requested", "confirmed", "rescheduled"].includes(item.status)
        && new Date(item.end_time || item.start_time || 0).getTime() >= Date.now()
      ).length,
      openOpportunities: activePipelineLeads.length,
      overdueNextActions: activePipelineLeads.filter((lead) =>
        lead.nextActionDueAt && new Date(lead.nextActionDueAt).getTime() < now
      ).length,
      unassignedOpportunities: activePipelineLeads.filter((lead) => !lead.opportunityOwner).length,
      deliverabilityAlerts: emailDeliveryEventRows.filter((item) => deliverabilityEvents.has(item.event_type)).length,
    },
    dimensionStats,
    categoryBreakdown,
    employeeStats,
    answerDistribution: buildAnswerDistribution(assessments),
    topRecommendations,
    assessments,
    contacts,
    inquiries,
    coaches: normalizedCoaches,
    employees: employeeRows,
    coachAssignments: assignmentRows,
    coachSessions: sessionRows,
    coachAvailability: availabilityRows,
    coachDocuments: documentRows,
    projects: projectRows,
    projectAssignments: projectAssignmentRows,
    smartActions: smartActionRows,
    calendarBookings: calendarBookingRows.map((item) => ({
      id: item.id,
      providerUid: item.provider_uid,
      leadId: item.lead_id || null,
      assessmentId: item.assessment_id || null,
      eventTypeSlug: item.event_type_slug || null,
      title: item.title || "Konsultasi BinaHub",
      status: item.status,
      attendeeName: item.attendee_name || "-",
      attendeeEmail: item.attendee_email || "-",
      organizerEmail: item.organizer_email || null,
      startTime: item.start_time || null,
      endTime: item.end_time || null,
      timeZone: item.time_zone || "Asia/Jakarta",
      meetingUrl: item.meeting_url || null,
      cancellationReason: item.cancellation_reason || null,
      updatedAt: item.updated_at || null,
      isUpcoming: ["requested", "confirmed", "rescheduled"].includes(item.status)
        && new Date(item.end_time || item.start_time || 0).getTime() >= Date.now(),
    })),
    pipelineLeads,
    opportunityActivities: opportunityActivityRows.map((item) => ({
      id: item.id,
      leadId: item.lead_id,
      assessmentId: item.assessment_id || null,
      inquiryId: item.inquiry_id || null,
      eventType: item.event_type,
      fromStage: item.from_stage || null,
      toStage: item.to_stage || null,
      actor: item.actor,
      note: item.note || null,
      metadata: item.metadata || {},
      createdAt: item.created_at,
    })),
    emailDeliverySummary,
    emailDeliveryEvents: emailDeliveryEventRows.map((item) => ({
      id: item.id,
      emailId: item.email_id || null,
      eventType: item.event_type,
      recipientEmail: item.recipient_email || null,
      senderEmail: item.sender_email || null,
      subject: item.subject || null,
      processingStatus: item.processing_status,
      errorMessage: item.error_message || null,
      providerCreatedAt: item.provider_created_at || null,
      receivedAt: item.received_at,
    })),
  });
}
