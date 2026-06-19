import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, getIdempotencyKey, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import {
  AssociateCandidate,
  generateAssociateInvitation,
  generateProjectAutopilotPlan,
  matchAssociatesForProject,
  ProjectAutopilotInput,
} from "@/lib/ai-service";
import { sendAssociateInvitationEmail } from "@/lib/email-service";

type AssociateRow = AssociateCandidate & {
  linkedin_summary?: string;
  notes?: string;
};

type ProjectRolePlan = {
  roleTitle?: string;
  role_title?: string;
  associateCategory?: string;
  associate_category?: string;
  requiredExpertise?: string;
  required_expertise?: string;
  quantity?: number;
  priority?: string;
  aiReason?: string;
  ai_reason?: string;
};

type InsertedProjectRole = {
  id?: string;
  role_title?: string;
};

type ProjectMatch = {
  roleTitle?: string;
  associateId?: string;
  associateName?: string;
  associateEmail?: string;
  matchScore?: number;
  matchReason?: string;
};

type InsertedAssignment = {
  id?: string;
  associate_email?: string;
  associate_name?: string;
  role_title?: string;
};

type SentInvitation = {
  assignmentId?: string;
  emailId?: string | null;
};

const autopilotBodySchema = z.object({
  projectId: z.string().trim().min(1, "Project ID wajib diisi."),
  sendInvitations: z.boolean().optional().default(false),
});

function toProjectInput(project: Record<string, unknown>, associates: AssociateRow[]): ProjectAutopilotInput {
  return {
    clientName: String(project.client_name || ""),
    contactName: String(project.contact_name || ""),
    contactEmail: String(project.contact_email || ""),
    programName: String(project.program_name || ""),
    service: String(project.service || ""),
    projectType: String(project.project_type || ""),
    scope: String(project.scope || ""),
    budgetNote: String(project.budget_note || ""),
    startDate: String(project.start_date || ""),
    endDate: String(project.end_date || ""),
    automationMode: String(project.automation_mode || "draft"),
    associates: associates.map((associate) => ({
      id: associate.id,
      name: associate.name,
      email: associate.email,
      category: associate.category,
      expertise: associate.expertise,
      field: associate.field,
      availability: associate.availability,
      rate: associate.rate,
      linkedinSummary: associate.linkedin_summary,
      notes: associate.notes,
    })),
  };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, autopilotBodySchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_AUTOPILOT_PAYLOAD");
  }

  const { projectId, sendInvitations } = parsed.data;
  const idempotencyKey = getIdempotencyKey(req);
  const db = createServerSupabase();
  const [{ data: project, error }, { data: associates }, { data: sentAssignments }] = await Promise.all([
    db.from("projects").select("*").eq("id", projectId).single(),
    db.from("coaches").select("*").in("status", ["active", "prospect"]).limit(120),
    db
      .from("project_assignments")
      .select("id, associate_email, invitation_sent_at")
      .eq("project_id", projectId)
      .not("invitation_sent_at", "is", null)
      .limit(1),
  ]);

  if (error || !project) {
    return adminError(error?.message || "Project tidak ditemukan.", 404, "PROJECT_NOT_FOUND");
  }

  if (sendInvitations && sentAssignments?.length) {
    return adminError(
      "Invitation untuk project ini sudah pernah dikirim. Buka assignment terkait untuk review sebelum mengirim ulang secara manual.",
      409,
      "PROJECT_INVITATION_ALREADY_SENT"
    );
  }

  const projectInput = toProjectInput(project, associates || []);
  if (!projectInput.associates?.length) {
    return adminError("Belum ada associate active/prospect yang bisa digunakan untuk matching.", 400, "NO_ASSOCIATE_CANDIDATES");
  }

  const plan = await generateProjectAutopilotPlan(projectInput);
  const roles = Array.isArray(plan.roles) ? plan.roles : [];
  const matches = await matchAssociatesForProject({ project: projectInput, roles, associates: projectInput.associates || [] });

  const { error: projectUpdateError } = await db.from("projects").update({
    ai_summary: plan.summary || null,
    ai_plan: plan,
    status: sendInvitations ? "Autopilot Running" : "Autopilot Drafted",
    updated_at: new Date().toISOString(),
  }).eq("id", projectId);

  if (projectUpdateError) {
    return adminError(`Gagal update project: ${projectUpdateError.message}`, 500, "PROJECT_UPDATE_FAILED");
  }

  const { error: roleDeleteError } = await db.from("project_roles").delete().eq("project_id", projectId);
  if (roleDeleteError) {
    return adminError(`Gagal reset project role: ${roleDeleteError.message}`, 500, "PROJECT_ROLE_RESET_FAILED");
  }

  const { error: assignmentDeleteError } = await db.from("project_assignments").delete().eq("project_id", projectId).eq("status", "Draft");
  if (assignmentDeleteError) {
    return adminError(`Gagal reset assignment draft: ${assignmentDeleteError.message}`, 500, "PROJECT_ASSIGNMENT_RESET_FAILED");
  }

  const roleRows = (roles as ProjectRolePlan[]).map((role) => ({
    project_id: projectId,
    role_title: String(role.roleTitle || role.role_title || "Associate"),
    associate_category: String(role.associateCategory || role.associate_category || ""),
    required_expertise: String(role.requiredExpertise || role.required_expertise || ""),
    quantity: Number(role.quantity || 1),
    priority: String(role.priority || "Normal"),
    status: "Open",
    ai_reason: String(role.aiReason || role.ai_reason || ""),
  }));

  const { data: insertedRoles, error: roleInsertError } = roleRows.length
    ? await db.from("project_roles").insert(roleRows).select()
    : { data: [] as InsertedProjectRole[], error: null };

  if (roleInsertError) {
    return adminError(`Gagal membuat project role: ${roleInsertError.message}`, 500, "PROJECT_ROLE_CREATE_FAILED");
  }

  const roleByTitle = new Map((insertedRoles || []).map((role: InsertedProjectRole) => [String(role.role_title), role]));
  const assignmentRows = (matches as ProjectMatch[]).map((match) => {
    const role = roleByTitle.get(String(match.roleTitle || ""));
    return {
      project_id: projectId,
      project_role_id: role?.id || null,
      associate_id: match.associateId || null,
      associate_name: String(match.associateName || ""),
      associate_email: String(match.associateEmail || ""),
      role_title: String(match.roleTitle || "Associate"),
      status: sendInvitations ? "Invitation Pending" : "Draft",
      match_score: Number(match.matchScore || 0),
      match_reason: String(match.matchReason || ""),
      notes: "Generated by Project Autopilot",
    };
  });

  const { data: insertedAssignments, error: assignmentInsertError } = assignmentRows.length
    ? await db.from("project_assignments").insert(assignmentRows).select()
    : { data: [] as InsertedAssignment[], error: null };

  if (assignmentInsertError) {
    return adminError(`Gagal membuat assignment AI: ${assignmentInsertError.message}`, 500, "PROJECT_ASSIGNMENT_CREATE_FAILED");
  }

  const sent: SentInvitation[] = [];
  if (sendInvitations) {
    for (const assignment of insertedAssignments || []) {
      if (!assignment.associate_email) continue;
      const invitation = await generateAssociateInvitation({
        associateName: assignment.associate_name || "Associate BinaHub",
        roleTitle: assignment.role_title || "Associate",
        clientName: String(project.client_name || ""),
        programName: String(project.program_name || ""),
        service: String(project.service || ""),
        startDate: String(project.start_date || ""),
        endDate: String(project.end_date || ""),
        scope: String(project.scope || ""),
        agreementType: "invitation",
      });

      const document = await db.from("generated_documents").insert({
        target_type: "project_assignment",
        target_id: assignment.id,
        document_type: "associate_invitation",
        title: invitation.documentTitle || `Surat Ajakan Kerja Sama - ${project.program_name}`,
        body: invitation.documentBody || "",
        status: "Generated",
        generated_by: "ai",
      }).select().single();

      if (document.error) {
        return adminError(`Gagal membuat dokumen invitation: ${document.error.message}`, 500, "INVITATION_DOCUMENT_CREATE_FAILED");
      }

      const email = await sendAssociateInvitationEmail(
        assignment.associate_email,
        assignment.associate_name || "Associate BinaHub",
        invitation.subject || `Ajakan Kerja Sama BinaHub - ${project.program_name}`,
        invitation.html || "",
        String(project.program_name || "")
      );

      const sentAt = new Date().toISOString();
      const { error: assignmentUpdateError } = await db.from("project_assignments").update({
        status: "Invitation Sent",
        invitation_email_id: email.data?.id || null,
        invitation_sent_at: sentAt,
        agreement_document_id: document.data?.id || null,
        agreement_status: "Generated",
        updated_at: sentAt,
      }).eq("id", assignment.id);

      if (assignmentUpdateError) {
        return adminError(`Invitation terkirim, tetapi status assignment gagal diupdate: ${assignmentUpdateError.message}`, 500, "INVITATION_STATUS_UPDATE_FAILED");
      }

      const { error: communicationError } = await db.from("communications").insert({
        target_type: "project_assignment",
        target_id: assignment.id,
        channel: "email",
        recipient_email: assignment.associate_email,
        recipient_name: assignment.associate_name,
        subject: invitation.subject,
        body_html: invitation.html,
        provider_id: email.data?.id || null,
        status: "Sent",
        sent_at: sentAt,
      });

      if (communicationError) {
        return adminError(`Invitation terkirim, tetapi log komunikasi gagal: ${communicationError.message}`, 500, "COMMUNICATION_LOG_FAILED");
      }

      sent.push({ assignmentId: assignment.id, emailId: email.data?.id || null });
    }
  }

  await logAdminEvent(db, {
    eventType: "project_autopilot_completed",
    targetType: "project",
    targetId: projectId,
    actor: admin.email,
    payload: { plan, matches, sent, idempotencyKey },
    status: "Completed",
    message: `Project Autopilot selesai untuk ${project.program_name}.`,
  });

  const nextActionType = sendInvitations ? "review_project_assignment" : "send_associate_invitations";
  const { data: existingAction } = await db
    .from("smart_actions")
    .select("id")
    .eq("target_type", "project")
    .eq("target_id", projectId)
    .eq("action_type", nextActionType)
    .in("status", ["Pending", "In Progress"])
    .maybeSingle();

  if (!existingAction) {
    await db.from("smart_actions").insert({
      action_type: nextActionType,
      title: sendInvitations ? `Review assignment terkirim: ${project.program_name}` : `Kirim invitation associate: ${project.program_name}`,
      description: sendInvitations
        ? "Invitation telah dikirim. Review acceptance dan kesiapan dokumen."
        : "Draft role dan matching associate sudah tersedia. Kirim invitation setelah review.",
      target_type: "project",
      target_id: projectId,
      priority: "High",
      status: "Pending",
      mode: sendInvitations ? "suggested" : "approval_required",
      recommendation: { plan, matches },
    });
  }

  return NextResponse.json({ success: true, plan, matches, sent });
}
