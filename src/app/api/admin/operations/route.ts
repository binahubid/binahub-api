import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { operationalTaskUpdateSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [tasks, taskEvents, runs] = await Promise.all([
    db.from("operational_tasks")
      .select("id, task_key, task_type, title, description, priority, status, assigned_to, due_at, sla_policy_key, escalation_level, escalated_at, lead_id, client_account_id, project_id, milestone_id, retention_opportunity_id, metadata, resolution_note, completed_at, completed_by, created_by, updated_by, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(300),
    db.from("operational_task_events")
      .select("id, task_id, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("automation_runs")
      .select("id, workflow_key, idempotency_key, trigger_source, dry_run, status, reference_date, candidate_count, processed_count, failure_count, summary, error_message, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(100),
  ]);

  const migrationMissing = [tasks.error, taskEvents.error, runs.error]
    .find((error) => error?.code === "42P01" || error?.message?.includes("does not exist"));
  if (migrationMissing) {
    return NextResponse.json({
      success: true,
      phase4Ready: false,
      tasks: [],
      taskEvents: [],
      automationRuns: [],
    });
  }
  const queryError = tasks.error || taskEvents.error || runs.error;
  if (queryError) return adminError(queryError.message, 500, "OPERATIONS_LOAD_FAILED");

  return NextResponse.json({
    success: true,
    phase4Ready: true,
    tasks: (tasks.data || []).map((item) => ({
      id: item.id,
      taskKey: item.task_key,
      taskType: item.task_type,
      title: item.title,
      description: item.description,
      priority: item.priority,
      status: item.status,
      assignedTo: item.assigned_to,
      dueAt: item.due_at,
      slaPolicyKey: item.sla_policy_key,
      escalationLevel: item.escalation_level,
      escalatedAt: item.escalated_at,
      leadId: item.lead_id,
      clientAccountId: item.client_account_id,
      projectId: item.project_id,
      milestoneId: item.milestone_id,
      retentionOpportunityId: item.retention_opportunity_id,
      metadata: item.metadata || {},
      resolutionNote: item.resolution_note,
      completedAt: item.completed_at,
      completedBy: item.completed_by,
      createdBy: item.created_by,
      updatedBy: item.updated_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    taskEvents: (taskEvents.data || []).map((item) => ({
      id: item.id,
      taskId: item.task_id,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
    automationRuns: (runs.data || []).map((item) => ({
      id: item.id,
      workflowKey: item.workflow_key,
      idempotencyKey: item.idempotency_key,
      triggerSource: item.trigger_source,
      dryRun: item.dry_run,
      status: item.status,
      referenceDate: item.reference_date,
      candidateCount: item.candidate_count,
      processedCount: item.processed_count,
      failureCount: item.failure_count,
      summary: item.summary || {},
      errorMessage: item.error_message,
      startedAt: item.started_at,
      finishedAt: item.finished_at,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, operationalTaskUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_OPERATIONAL_TASK");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("update_operational_task", {
    p_task_id: input.taskId,
    p_actor: admin.email,
    p_status: input.status,
    p_priority: input.priority,
    p_assigned_to: input.assignedTo || null,
    p_due_at: input.dueAt || null,
    p_resolution_note: input.resolutionNote || null,
  });

  if (error) {
    if (error.message.includes("OPERATIONAL_TASK_NOT_FOUND")) return adminError("Operational task tidak ditemukan.", 404, "OPERATIONAL_TASK_NOT_FOUND");
    if (error.message.includes("OPERATIONAL_TASK_OWNER_REQUIRED")) return adminError("Owner wajib untuk task aktif atau menunggu.", 400, "OPERATIONAL_TASK_OWNER_REQUIRED");
    if (error.message.includes("OPERATIONAL_TASK_RESOLUTION_REQUIRED")) return adminError("Catatan penyelesaian minimal 5 karakter.", 400, "OPERATIONAL_TASK_RESOLUTION_REQUIRED");
    return adminError(error.message, 500, "OPERATIONAL_TASK_UPDATE_FAILED");
  }

  return NextResponse.json({ success: true, task: data });
}
