import "server-only";
import { SPIN_DEFINITION, validateSpinAnswers } from "@/lib/spin/intake";
import { validateMeetingWrite } from "@/lib/spin/meeting";
import { spinSanitize } from "@/lib/spin/form";
import { ConsultantError, consultantRPC } from "./http";
import { consultantAction, type ConsultantDetail } from "./schemas";
import { canUseClientAnswers, readConsultantRecommendation } from "./recommendation";

export async function readConsultation(actor: string, lead: string, page = 0) {
  const detail = await consultantRPC<ConsultantDetail>(
    "consultant_portal_detail",
    {
      p_actor: actor,
      p_lead: lead,
      p_history_page: page,
    },
  );
  const workspace = detail.workspace;
  const answers = spinSanitize(SPIN_DEFINITION, {
    ...workspace?.original_answers,
    ...workspace?.answers,
  });
  const durations: Record<string, number> = {
    half: 0.5,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const venue =
    answers.deliveryMode === "online"
      ? "online"
      : answers.deliveryMode === "hybrid" || answers.venue === "mixed"
        ? "hybrid"
        : answers.venue === "indoor" || answers.venue === "outdoor"
          ? answers.venue
          : undefined;
  return {
    ...detail,
    proposalDefaults: {
      participants:
        typeof answers.participantCount === "number"
          ? answers.participantCount
          : undefined,
      days: durations[String(answers.duration)],
      venue,
      location: typeof answers.location === "string" ? answers.location : "",
      spiritualOptIn: answers.spiritualOptIn === "yes",
    },
  };
}
export function meetingContext(detail: ConsultantDetail) {
  const w = detail.workspace;
  return {
    definition: SPIN_DEFINITION,
    original: w?.original_answers || {},
    checklist: {
      id: detail.record.id,
      source_id: w?.source_id || null,
      contact: {
        name: detail.record.name,
        company: detail.record.company,
        email: detail.record.email,
      },
      answers: w?.answers || {},
      notes: w?.notes || "",
      status: w?.checklist_status || "in_progress",
      revision: w?.version || 0,
      updated_at: w?.updated_at || null,
    },
  };
}
export async function saveConsultation(
  actor: string,
  lead: string,
  raw: unknown,
) {
  const value = consultantAction.parse(raw);
  const detail = await readConsultation(actor, lead);
  if (!detail.record.canEdit)
    throw new ConsultantError("CONSULTANT_NOT_ASSIGNED", 403);
  if (value.action === "client_answers") {
    const initial = await readConsultantRecommendation(detail);
    if (!initial || initial.source.id !== value.sourceId
      || !canUseClientAnswers(detail, initial)) {
      throw new ConsultantError("CONSULTANT_CLIENT_ANSWERS_REQUIRED", 409);
    }
    let version = value.version;
    if (!detail.workspace?.source_id) {
      await consultantRPC("consultant_save_work", {
        p_actor: actor, p_lead: lead, p_version: version,
        p_action: "source", p_data: { sourceId: initial.source.id },
      });
      version++;
    }
    await consultantRPC("consultant_save_work", {
      p_actor: actor, p_lead: lead, p_version: version,
      p_action: "meeting", p_data: { answers: {}, notes: "", status: "completed" },
    });
    return readConsultation(actor, lead);
  }
  let data: Record<string, unknown> = value;
  if (value.action === "meeting") {
    const checked = validateMeetingWrite(
      {
        revision: value.version,
        answers: value.answers,
        notes: value.notes,
        status: value.status,
      },
      validateSpinAnswers(detail.workspace?.original_answers || {}),
    );
    data = {
      answers: checked.answers,
      notes: checked.notes,
      status: checked.status,
    };
  }
  await consultantRPC("consultant_save_work", {
    p_actor: actor,
    p_lead: lead,
    p_version: value.version,
    p_action: value.action,
    p_data: data,
  });
  return readConsultation(actor, lead);
}
