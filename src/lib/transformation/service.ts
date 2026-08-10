import { createServerSupabase } from "@/lib/supabase";
import { createHash, randomBytes } from "node:crypto";
import type { TransformationActor } from "@/lib/transformation/auth";

type Db = ReturnType<typeof createServerSupabase>;

type CapabilityEvidence = {
  id: string;
  type: string;
  confidence_score: number | string;
  capability_tags: string[];
};

const evidenceWeights: Record<string, number> = {
  assessment: 1,
  reflection: 0.55,
  observation: 0.85,
  feedback: 0.8,
  coaching_note: 0.7,
  action_completion: 0.75,
  survey: 0.65,
};

export function getDb() {
  return createServerSupabase();
}

export async function getOrganizationIdForEngagement(db: Db, engagementId: string) {
  const { data, error } = await db.from("engagements").select("organization_id").eq("id", engagementId).single();
  if (error) throw new Error(error.message);
  return data.organization_id as string;
}

export async function createEngagement(
  db: Db,
  actor: TransformationActor,
  payload: {
    organizationId: string;
    code: string;
    title: string;
    type: string;
    status: string;
    startDate?: string;
    endDate?: string;
  },
) {
  let orgId = payload.organizationId;
  
  // Ensure a valid organization exists to satisfy foreign key constraint
  if (!orgId) {
    const { data: firstOrg } = await db.from("organizations").select("id").limit(1).maybeSingle();
    if (firstOrg?.id) {
      orgId = firstOrg.id;
    } else {
      const { data: newOrg } = await db.from("organizations").insert({ name: "BinaHub Client Partner" }).select("id").single();
      orgId = newOrg?.id;
    }
  } else {
    const { data: orgCheck } = await db.from("organizations").select("id").eq("id", orgId).maybeSingle();
    if (!orgCheck) {
      const { data: newOrg } = await db.from("organizations").insert({ id: orgId, name: "BinaHub Client Partner" }).select("id").maybeSingle();
      if (newOrg) {
        orgId = newOrg.id;
      } else {
        const { data: firstOrg } = await db.from("organizations").select("id").limit(1).maybeSingle();
        orgId = firstOrg?.id || orgId;
      }
    }
  }

  const { data, error } = await db
    .from("engagements")
    .insert({
      organization_id: orgId,
      code: payload.code,
      title: payload.title,
      type: payload.type,
      status: payload.status,
      start_date: payload.startDate || null,
      end_date: payload.endDate || null,
      created_by: actor.userId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createParticipant(
  db: Db,
  payload: {
    organizationId: string;
    engagementId?: string;
    name: string;
    email?: string;
    roleTitle?: string;
    department?: string;
    engagementRole: string;
  },
) {
  let orgId = payload.organizationId;
  if (!orgId) {
    const { data: firstOrg } = await db.from("organizations").select("id").limit(1).maybeSingle();
    orgId = firstOrg?.id;
  }

  const { data: participant, error } = await db
    .from("participants")
    .insert({
      organization_id: orgId,
      name: payload.name,
      email: payload.email || null,
      role_title: payload.roleTitle || null,
      department: payload.department || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (payload.engagementId) {
    const { error: assignmentError } = await db.from("engagement_participants").insert({
      engagement_id: payload.engagementId,
      participant_id: participant.id,
      role: payload.engagementRole,
    });
    if (assignmentError) throw new Error(assignmentError.message);
  }

  return participant;
}

function hashAccessCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function generateAccessCode(companyPrefix: string, teamName: string, index: number) {
  const suffix = String.fromCharCode(65 + index);
  return `${companyPrefix.toUpperCase()}-${suffix}`;
}

export async function generateAccessCodesForEngagement(
  db: Db,
  engagementId: string,
  organizationId: string,
  organizationName: string,
  participants: Array<{ id: string; name: string }>,
) {
  const prefix = organizationName
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 10)
    .toUpperCase();

  const codes: Array<{ code: string; companyName: string; teamName: string; participantId: string }> = [];

  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    const code = generateAccessCode(prefix, participant.name, i);

    const { error } = await db.from("app_client_access_codes").insert({
      company_name: organizationName,
      team_name: participant.name,
      code_hash: hashAccessCode(code),
      is_active: true,
      organization_id: organizationId,
      participant_id: participant.id,
    });

    if (error) throw new Error(error.message);

    codes.push({
      code,
      companyName: organizationName,
      teamName: participant.name,
      participantId: participant.id,
    });
  }

  return codes;
}

export async function getAccessCodesForEngagement(db: Db, engagementId: string) {
  const { data: epData, error: epError } = await db
    .from("engagement_participants")
    .select("participant_id")
    .eq("engagement_id", engagementId);

  if (epError) throw new Error(epError.message);
  if (!epData || epData.length === 0) return [];

  const participantIds = epData.map((ep) => ep.participant_id);

  const { data: codes, error: codesError } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, is_active, organization_id, participant_id, created_at")
    .in("participant_id", participantIds);

  if (codesError) throw new Error(codesError.message);
  return codes || [];
}

export async function createEvidence(
  db: Db,
  actor: TransformationActor,
  payload: {
    engagementId: string;
    participantId?: string;
    type: string;
    source: string;
    content: Record<string, unknown>;
    capabilityTags: string[];
    confidenceScore: number;
  },
) {
  if (actor.role === "client" && !["reflection", "survey", "action_completion"].includes(payload.type)) {
    throw new Error("Client hanya dapat membuat reflection, survey, atau action completion evidence.");
  }

  const { data, error } = await db
    .from("evidence")
    .insert({
      engagement_id: payload.engagementId,
      participant_id: payload.participantId || null,
      type: payload.type,
      source: payload.source,
      content: payload.content,
      capability_tags: payload.capabilityTags,
      confidence_score: payload.confidenceScore,
      created_by: actor.userId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function submitReflection(
  db: Db,
  actor: TransformationActor,
  payload: {
    engagementId: string;
    participantId: string;
    prompt: string;
    situation: string;
    learning: string;
    nextAction: string;
    capabilityTags: string[];
    confidenceScore: number;
  },
) {
  const evidence = await createEvidence(db, actor, {
    engagementId: payload.engagementId,
    participantId: payload.participantId,
    type: "reflection",
    source: "participant",
    content: {
      prompt: payload.prompt,
      situation: payload.situation,
      learning: payload.learning,
      next_action: payload.nextAction,
      text: `${payload.situation}\n\nLearning: ${payload.learning}\n\nNext action: ${payload.nextAction}`,
    },
    capabilityTags: payload.capabilityTags,
    confidenceScore: payload.confidenceScore,
  });

  const { data, error } = await db
    .from("reflections")
    .insert({
      participant_id: payload.participantId,
      engagement_id: payload.engagementId,
      question: payload.prompt,
      answer: `${payload.situation}\n\n${payload.learning}\n\n${payload.nextAction}`,
      evidence_id: evidence.id,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await db.rpc("enqueue_transformation_event", {
    p_type: "ReflectionSubmitted",
    p_aggregate_type: "reflection",
    p_aggregate_id: data.id,
    p_engagement_id: payload.engagementId,
    p_participant_id: payload.participantId,
    p_payload: { reflection_id: data.id, evidence_id: evidence.id },
  });

  return { reflection: data, evidence };
}

export async function createAction(
  db: Db,
  actor: TransformationActor,
  payload: {
    engagementId: string;
    participantId?: string;
    title: string;
    description?: string;
    status: string;
    dueDate?: string;
    progress: number;
  },
) {
  const { data, error } = await db
    .from("actions")
    .insert({
      engagement_id: payload.engagementId,
      participant_id: payload.participantId || null,
      title: payload.title,
      description: payload.description || null,
      status: payload.status,
      due_date: payload.dueDate || null,
      progress: payload.progress,
      created_by: actor.userId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateAction(db: Db, actionId: string, payload: Record<string, unknown>, actor?: TransformationActor) {
  const { data: before, error: beforeError } = await db
    .from("actions")
    .select("*")
    .eq("id", actionId)
    .single();

  if (beforeError) throw new Error(beforeError.message);

  const updatePayload: Record<string, unknown> = {};
  if (payload.status) updatePayload.status = payload.status;
  if (payload.progress !== undefined) updatePayload.progress = payload.progress;
  if (payload.title) updatePayload.title = payload.title;
  if (payload.description !== undefined) updatePayload.description = payload.description || null;
  if (payload.dueDate !== undefined) updatePayload.due_date = payload.dueDate || null;

  const { data, error } = await db.from("actions").update(updatePayload).eq("id", actionId).select().single();
  if (error) throw new Error(error.message);

  const statusChanged = payload.status !== undefined && payload.status !== before.status;
  const progressChanged = payload.progress !== undefined && Number(payload.progress) !== Number(before.progress);
  if ((statusChanged || progressChanged) && data.participant_id) {
    await createEvidence(db, actor || { role: "worker", userId: null, email: "system@binahub.id" }, {
      engagementId: data.engagement_id,
      participantId: data.participant_id,
      type: "action_completion",
      source: actor?.role === "client" ? "participant" : actor?.role === "facilitator" ? "facilitator" : "system",
      content: {
        action_id: data.id,
        title: data.title,
        previous_status: before.status,
        status: data.status,
        previous_progress: before.progress,
        progress: data.progress,
        text: `Action updated: ${data.title} (${before.status}/${before.progress}% -> ${data.status}/${data.progress}%)`,
      },
      capabilityTags: [],
      confidenceScore: data.status === "done" ? 0.8 : 0.55,
    });
  }

  return data;
}

export async function getParticipantTimeline(db: Db, participantId: string, engagementId?: string) {
  let evidenceQuery = db
    .from("evidence")
    .select("*")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false });
  let actionQuery = db
    .from("actions")
    .select("*")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false });
  let reflectionQuery = db
    .from("reflections")
    .select("*")
    .eq("participant_id", participantId)
    .order("created_at", { ascending: false });

  if (engagementId) {
    evidenceQuery = evidenceQuery.eq("engagement_id", engagementId);
    actionQuery = actionQuery.eq("engagement_id", engagementId);
    reflectionQuery = reflectionQuery.eq("engagement_id", engagementId);
  }

  const [evidenceResult, actionResult, reflectionResult, capabilityResult] = await Promise.all([
    evidenceQuery,
    actionQuery,
    reflectionQuery,
    db
      .from("participant_capabilities")
      .select("*, capability:capabilities(*)")
      .eq("participant_id", participantId)
      .order("last_updated", { ascending: false }),
  ]);

  if (evidenceResult.error) throw new Error(evidenceResult.error.message);
  if (actionResult.error) throw new Error(actionResult.error.message);
  if (reflectionResult.error) throw new Error(reflectionResult.error.message);
  if (capabilityResult.error) throw new Error(capabilityResult.error.message);

  return {
    evidence: evidenceResult.data || [],
    actions: actionResult.data || [],
    reflections: reflectionResult.data || [],
    capabilities: capabilityResult.data || [],
  };
}

export async function recalculateParticipantCapabilities(db: Db, participantId: string, eventId?: string) {
  const { data: evidence, error: evidenceError } = await db
    .from("evidence")
    .select("id, type, confidence_score, capability_tags")
    .eq("participant_id", participantId);

  if (evidenceError) throw new Error(evidenceError.message);

  const { data: capabilities, error: capabilityError } = await db.from("capabilities").select("id, name");
  if (capabilityError) throw new Error(capabilityError.message);

  const rows = (evidence || []) as CapabilityEvidence[];
  const results = [];

  for (const capability of capabilities || []) {
    const related = rows.filter((item) => item.capability_tags?.includes(capability.name));
    if (!related.length) continue;

    const weighted = related.reduce(
      (total, item) => {
        const weight = evidenceWeights[item.type] || 0.5;
        const confidence = Number(item.confidence_score || 0.5);
        return {
          score: total.score + confidence * 100 * weight,
          weight: total.weight + weight,
        };
      },
      { score: 0, weight: 0 },
    );

    const score = weighted.weight ? Number((weighted.score / weighted.weight).toFixed(2)) : 0;

    const { data: previous } = await db
      .from("participant_capabilities")
      .select("score")
      .eq("participant_id", participantId)
      .eq("capability_id", capability.id)
      .maybeSingle();

    const previousScore = previous?.score === undefined ? score : Number(previous.score);
    const trend = score > previousScore ? "up" : score < previousScore ? "down" : "stable";

    const { data, error } = await db
      .from("participant_capabilities")
      .upsert(
        {
          participant_id: participantId,
          capability_id: capability.id,
          score,
          trend,
          evidence_count: related.length,
          last_event_id: eventId || null,
          last_updated: new Date().toISOString(),
        },
        { onConflict: "participant_id,capability_id" },
      )
      .select()
      .single();

    if (error) throw new Error(error.message);

    await Promise.all(
      related.map((item) =>
        db.from("capability_evidence").upsert(
          {
            capability_id: capability.id,
            evidence_id: item.id,
            weight: evidenceWeights[item.type] || 0.5,
          },
          { onConflict: "capability_id,evidence_id" },
        ),
      ),
    );

    results.push(data);
  }

  if (results.length) {
    await db.rpc("enqueue_transformation_event", {
      p_type: "CapabilityRecalculated",
      p_aggregate_type: "participant",
      p_aggregate_id: participantId,
      p_engagement_id: null,
      p_participant_id: participantId,
      p_payload: { participant_id: participantId, capability_count: results.length, source_event_id: eventId || null },
    });
  }

  return results;
}

export async function generateInsightDraft(db: Db, engagementId: string, type: "risk" | "improvement" | "recommendation", eventId?: string) {
  const organizationId = await getOrganizationIdForEngagement(db, engagementId);
  const { data: evidence, error } = await db
    .from("evidence")
    .select("id, type, source, content, capability_tags, confidence_score")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  if (!evidence?.length) throw new Error("Insight membutuhkan evidence terlebih dahulu.");

  const tags = Array.from(new Set(evidence.flatMap((item) => item.capability_tags || []))).slice(0, 5);
  const summary = `Draft insight based on ${evidence.length} evidence item(s). Capability signals: ${tags.join(", ") || "uncategorized"}.`;

  const { data, error: insertError } = await db
    .from("insights")
    .insert({
      organization_id: organizationId,
      engagement_id: engagementId,
      title: `Evidence-based ${type} insight`,
      summary,
      type,
      evidence_links: evidence.map((item) => item.id),
      confidence_score: 0.65,
      created_by_event_id: eventId || null,
    })
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);

  await db.from("ai_generation_logs").insert({
    input_type: "engagement_evidence",
    input_id: engagementId,
    output_type: "insight",
    output_id: data.id,
    model: process.env.OPENROUTER_MODEL || "stateless-draft",
  });

  return data;
}

export async function processPendingEvents(db: Db, limit = 10) {
  const { data: events, error } = await db
    .from("event_queue")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const processed = [];
  for (const event of events || []) {
    await db.from("event_queue").update({ status: "processing", attempts: Number(event.attempts || 0) + 1 }).eq("id", event.id);

    try {
      if (["EvidenceCreated", "ReflectionSubmitted", "ObservationAdded"].includes(event.type) && event.participant_id) {
        await recalculateParticipantCapabilities(db, event.participant_id, event.id);
      }

      if (event.type === "CapabilityRecalculated" && event.engagement_id) {
        await generateInsightDraft(db, event.engagement_id, "recommendation", event.id);
      }

      await db.from("event_queue").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", event.id);
      processed.push({ id: event.id, type: event.type, status: "done" });
    } catch (err) {
      await db
        .from("event_queue")
        .update({ status: "failed", error_message: err instanceof Error ? err.message : "Unknown worker error" })
        .eq("id", event.id);
      processed.push({ id: event.id, type: event.type, status: "failed" });
    }
  }

  return processed;
}
