import { NextRequest, NextResponse } from "next/server";
import { adminError } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import {
  evaluateLaunchReadiness,
  type LaunchRunEvidence,
  type LaunchWorkflowKey,
} from "@/lib/launch-readiness";
import { createServerSupabase } from "@/lib/supabase";

type RuleRecord = {
  version?: string | null;
  status?: string | null;
  is_mock?: boolean | null;
  rules?: Record<string, unknown> | null;
};

type RunRecord = {
  workflow_key: string;
  status: string;
  dry_run: boolean;
  candidate_count: number;
  processed_count: number;
  failure_count: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};

function configured(value: string | undefined, minimumLength = 1) {
  return Boolean(value && value.trim().length >= minimumLength);
}

function activationSnapshot(record: RuleRecord | null) {
  const rules = record?.rules && typeof record.rules === "object" ? record.rules : {};
  const activation = rules.activation && typeof rules.activation === "object"
    ? rules.activation as Record<string, unknown>
    : {};
  return {
    version: record?.version || null,
    status: record?.status || null,
    isMock: record?.is_mock !== false,
    outboundAutomationEnabled: activation.outboundAutomationEnabled === true,
    activationBlockers: Array.isArray(activation.blockers)
      ? activation.blockers.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function latestRunMap(rows: RunRecord[]) {
  const supported = new Set<LaunchWorkflowKey>([
    "follow_up_scheduler",
    "transformation_event_worker",
    "client_operations_daily",
    "acquisition_batch_processor",
  ]);
  const result: Partial<Record<LaunchWorkflowKey, LaunchRunEvidence>> = {};
  for (const row of rows) {
    if (!supported.has(row.workflow_key as LaunchWorkflowKey)) continue;
    const key = row.workflow_key as LaunchWorkflowKey;
    if (result[key]) continue;
    result[key] = {
      status: row.status,
      dryRun: row.dry_run,
      candidateCount: row.candidate_count,
      processedCount: row.processed_count,
      failureCount: row.failure_count,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
    };
  }
  return result;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [rules, modules, templates, runs, deliveryEvents, failedEvents, bookings, sources, campaigns, batches] = await Promise.all([
    db.from("business_rule_sets")
      .select("version, status, is_mock, rules, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("catalog_modules").select("readiness_status, is_mock, active, base_price"),
    db.from("outreach_templates").select("status, is_mock, owner, approved_by, approved_at"),
    db.from("automation_runs")
      .select("workflow_key, status, dry_run, candidate_count, processed_count, failure_count, started_at, finished_at, error_message")
      .order("started_at", { ascending: false })
      .limit(200),
    db.from("email_delivery_events").select("id", { count: "exact", head: true }),
    db.from("event_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    db.from("calendar_bookings").select("provider_series_uid, status"),
    db.from("acquisition_sources").select("status, active"),
    db.from("acquisition_campaigns").select("status"),
    db.from("prospect_import_batches").select("status"),
  ]);

  const queryError = [rules.error, modules.error, templates.error, runs.error, deliveryEvents.error, failedEvents.error, bookings.error, sources.error, campaigns.error, batches.error]
    .find(Boolean);
  if (queryError) {
    if (queryError.code === "42P01" || queryError.message?.includes("does not exist")) {
      return NextResponse.json({ success: true, phase8Ready: false, error: "Migration fondasi Launch Control belum lengkap." });
    }
    return adminError(queryError.message || "Launch readiness gagal dibaca.", 500, "LAUNCH_READINESS_LOAD_FAILED");
  }

  const ruleRows = (rules.data || []) as RuleRecord[];
  const selectedRule = ruleRows.find((item) => item.status === "active" && item.is_mock === false)
    || ruleRows.find((item) => item.is_mock === false)
    || ruleRows[0]
    || null;
  const moduleRows = modules.data || [];
  const templateRows = templates.data || [];
  const bookingRows = bookings.data || [];
  const activeBySeries = new Map<string, number>();
  let calendarLineageIssueCount = 0;
  for (const booking of bookingRows) {
    const seriesUid = booking.provider_series_uid;
    if (!seriesUid) {
      calendarLineageIssueCount += 1;
      continue;
    }
    if (["requested", "confirmed"].includes(booking.status)) {
      activeBySeries.set(seriesUid, (activeBySeries.get(seriesUid) || 0) + 1);
    }
  }
  calendarLineageIssueCount += [...activeBySeries.values()].filter((count) => count > 1).length;

  const readiness = evaluateLaunchReadiness({
    configuration: {
      followUpSecret: configured(process.env.FOLLOW_UP_CRON_SECRET, 24),
      transformationWorkerSecret: configured(process.env.TRANSFORMATION_WORKER_SECRET, 24),
      operationsSecret: configured(process.env.OPERATIONS_CRON_SECRET, 24),
      acquisitionSecret: configured(process.env.ACQUISITION_CRON_SECRET, 24),
      resendApiKey: configured(process.env.RESEND_API_KEY, 10),
      resendWebhookSecret: configured(process.env.RESEND_WEBHOOK_SECRET, 16),
      calBookingUrl: configured(process.env.CALCOM_BOOKING_URL, 10),
      approvedTemplateRequired: process.env.FOLLOW_UP_REQUIRE_APPROVED_TEMPLATE !== "false",
      followUpDryRun: process.env.FOLLOW_UP_DRY_RUN === "true",
      transformationWorkerDryRun: process.env.TRANSFORMATION_WORKER_DRY_RUN === "true",
      operationsDryRun: process.env.OPERATIONS_DRY_RUN !== "false",
      acquisitionDryRun: process.env.ACQUISITION_DRY_RUN !== "false",
    },
    businessRules: activationSnapshot(selectedRule),
    catalog: {
      readyNonMockModules: moduleRows.filter((item) => item.active && item.readiness_status === "ready" && !item.is_mock).length,
      pricedReadyModules: moduleRows.filter((item) => item.active && item.readiness_status === "ready" && !item.is_mock && Number(item.base_price) > 0).length,
    },
    templates: {
      required: 18,
      approvedNonMock: templateRows.filter((item) => item.status === "approved" && !item.is_mock && item.owner && item.approved_by && item.approved_at).length,
    },
    acquisition: {
      approvedActiveSources: (sources.data || []).filter((item) => item.status === "approved" && item.active).length,
      approvedOrActiveCampaigns: (campaigns.data || []).filter((item) => ["approved", "active"].includes(item.status)).length,
      approvedBatches: (batches.data || []).filter((item) => item.status === "approved").length,
    },
    evidence: {
      latestRuns: latestRunMap((runs.data || []) as RunRecord[]),
      emailDeliveryEventCount: deliveryEvents.count || 0,
      eventQueueFailedCount: failedEvents.count || 0,
      calendarBookingCount: bookingRows.length,
      calendarLineageIssueCount,
    },
  });

  return NextResponse.json({
    success: true,
    phase8Ready: true,
    readOnly: true,
    ...readiness,
  });
}
