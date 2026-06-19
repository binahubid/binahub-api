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
  source?: string;
  challenge?: string;
  target?: string;
  answers?: Record<string, number>;
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
  proposal_data?: unknown;
  created_at: string;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  source: string | null;
  lead_score: number | null;
  lead_status: string | null;
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
  created_at: string | null;
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
    "id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, assessment_status, result_email_sent_at, result_email_id, proposal_status, proposal_sent_at, proposal_email_id, proposal_requested_at, result_follow_up_level, result_follow_up_sent_at, result_follow_up_email_id, proposal_follow_up_level, proposal_follow_up_sent_at, proposal_follow_up_email_id, follow_up_history, proposal_data, created_at";

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

  const [{ data: leadRows }, { data: inquiryRows }] =
    await Promise.all([
      db
        .from("leads")
        .select("id, name, email, company, phone, source, lead_score, lead_status, notes, created_at")
        .order("created_at", { ascending: false }),
      db
        .from("inquiries")
        .select("id, lead_id, name, email, whatsapp, message, source, status, admin_notes, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

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
      resultFollowUpLevel: row.result_follow_up_level || 0,
      resultFollowUpSentAt: row.result_follow_up_sent_at || null,
      proposalFollowUpLevel: row.proposal_follow_up_level || 0,
      proposalFollowUpSentAt: row.proposal_follow_up_sent_at || null,
      leadScore: lead?.lead_score || null,
      leadStatus: lead?.lead_status || null,
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
      createdAt: item.created_at,
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

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
  });
}
