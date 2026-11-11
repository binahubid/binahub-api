import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import {
  sendOutreachEmail,
  OutreachSuppressedError,
} from "@/lib/email-service";
import { consultantRPC, ConsultantError } from "./http";
import { consultantProposalPDF } from "./pdf";
import type { ProposalSnapshot } from "./proposal";
import { messageInput, type ConsultantDetail } from "./schemas";

const envelopeSchema = z
  .object({
    to: z.email(),
    name: z.string(),
    company: z.string(),
    senderId: z.uuid(),
    senderName: z.string().min(1).max(200),
    replyTo: z.email(),
    subject: z.string().min(1).max(180),
    body: z.string().min(1).max(10000),
  })
  .strict();
type Message = {
  id: string;
  lead_id: string;
  proposal_id: string | null;
  envelope: unknown;
  lease_token: string;
};
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function consultantEmailReady() {
  return (
    process.env.OUTBOUND_EMAIL_FORCE_DISABLED !== "true" &&
    Boolean(process.env.RESEND_API_KEY) &&
    Boolean(process.env.EMAIL_FROM?.includes("@")) &&
    !process.env.EMAIL_FROM?.includes("resend.dev") &&
    (process.env.UNSUBSCRIBE_SECRET?.length || 0) >= 32 &&
    Boolean(process.env.NEXT_PUBLIC_BINAHUB_API_URL)
  );
}
export async function queueConsultantMessage(
  actor: string,
  lead: string,
  detail: ConsultantDetail,
  raw: unknown,
) {
  const v = messageInput.parse(raw);
  if (!detail.record.canEdit)
    throw new ConsultantError("CONSULTANT_NOT_ASSIGNED", 403);
  if (!consultantEmailReady())
    throw new ConsultantError("CONSULTANT_EMAIL_SETUP", 409);
  const { data: member, error } = await createServerSupabase()
    .from("consultant_members")
    .select("user_id,display_name,email,active")
    .eq("user_id", detail.record.assigneeId)
    .maybeSingle();
  if (error || !member?.active)
    throw new ConsultantError("CONSULTANT_INVALID_MEMBER", 409);
  const envelope = envelopeSchema.parse({
    to: detail.record.email,
    name: detail.record.name,
    company: detail.record.company,
    senderId: member.user_id,
    senderName: member.display_name,
    replyTo: member.email,
    subject: v.subject,
    body: v.body,
  });
  return consultantRPC("consultant_queue_message", {
    p_actor: actor,
    p_lead: lead,
    p_version: v.version,
    p_id: v.id,
    p_proposal: v.proposalId,
    p_kind: v.kind,
    p_envelope: envelope,
    p_scheduled: v.scheduledAt,
  });
}
export async function processConsultantMessage(
  id?: string,
): Promise<{ processed: boolean; status?: string }> {
  if (!consultantEmailReady()) return { processed: false, status: "paused" };
  try {
    await consultantRPC("consultant_expire_messages");
  } catch (e) {
    if (e instanceof ConsultantError && e.code === "CONSULTANT_SETUP_REQUIRED")
      return { processed: false, status: "setup_required" };
    throw e;
  }
  const lease = randomUUID();
  const m = await consultantRPC<Message | null>("consultant_claim_message", {
    p_lease: lease,
    p_id: id || null,
  });
  if (!m) return { processed: false };
  let status = "failed",
    provider: string | null = null,
    reason: string | null = null,
    sending = false;
  try {
    const envelope = envelopeSchema.parse(m.envelope),
      db = createServerSupabase();
    const [member, lead, proposal] = await Promise.all([
      db
        .from("consultant_members")
        .select("email,display_name,active")
        .eq("user_id", envelope.senderId)
        .single(),
      db
        .from("leads")
        .select("email,name,company")
        .eq("id", m.lead_id)
        .single(),
      m.proposal_id
        ? db
            .from("consultant_proposals")
            .select("snapshot,revision")
            .eq("id", m.proposal_id)
            .eq("lead_id", m.lead_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (member.error || lead.error || proposal.error)
      throw new Error("CONTEXT_UNAVAILABLE");
    if (
      !member.data.active ||
      member.data.email !== envelope.replyTo ||
      member.data.display_name !== envelope.senderName ||
      lead.data.email.toLowerCase() !== envelope.to.toLowerCase() ||
      lead.data.name !== envelope.name ||
      (lead.data.company || "") !== envelope.company
    ) {
      status = "cancelled";
      throw new Error("CONTEXT_CHANGED");
    }
    const attachments = proposal.data
      ? [
          {
            filename: `BinaHub-Proposal-r${proposal.data.revision}.pdf`,
            content: await consultantProposalPDF(
              proposal.data.snapshot as ProposalSnapshot,
              proposal.data.revision,
            ),
          },
        ]
      : undefined;
    if (!consultantEmailReady()) {
      status = "cancelled";
      throw new Error("DELIVERY_PAUSED");
    }
    const html = `<p>Yth. Bapak/Ibu ${escape(envelope.name)},</p><div>${escape(envelope.body).replace(/\n/g, "<br>")}</div><p>Salam hangat,<br><strong>${escape(envelope.senderName)}</strong><br>Konsultan BinaHub<br>People. Learning. Elevated.</p>`;
    sending = true;
    const result = await sendOutreachEmail(
      envelope.to,
      envelope.name,
      envelope.subject,
      html,
      envelope.company,
      {
        idempotencyKey: `consultant/${m.id}`,
        category: "consultant_reviewed",
        senderName: `${envelope.senderName} | BinaHub`,
        replyTo: envelope.replyTo,
        attachments,
      },
    );
    provider = result.data?.id || null;
    // Missing acknowledgement must never trigger an automatic duplicate send.
    status = provider ? "accepted" : "uncertain";
    reason = provider ? null : "NO_PROVIDER_ACKNOWLEDGEMENT";
  } catch (e) {
    reason =
      e instanceof OutreachSuppressedError
        ? "RECIPIENT_SUPPRESSED"
        : sending
          ? "DELIVERY_NOT_CONFIRMED"
          : "DELIVERY_CONTEXT_CHANGED";
    if (e instanceof OutreachSuppressedError) status = "cancelled";
    else if (sending) status = "uncertain";
  }
  const saved = await consultantRPC<boolean>("consultant_finish_message", {
    p_id: m.id,
    p_lease: lease,
    p_status: status,
    p_provider: provider,
    p_error: reason,
  });
  return { processed: true, status: saved ? status : "uncertain" };
}
