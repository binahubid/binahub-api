import "server-only";
import { createHash } from "node:crypto";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
import { SPIN_DEFINITION, validateSpinAnswers } from "@/lib/spin/intake";
import { spinSummary } from "@/lib/spin/form";
import { ConsultantError, consultantRPC } from "./http";
import { proposalInput, type ConsultantDetail } from "./schemas";

export type ProposalSnapshot = {
  company: string;
  name: string;
  email: string;
  consultant: string;
  issuedAt: string;
  summary: ReturnType<typeof spinSummary>;
  days: number;
  participants: number;
  venue: string;
  location: string;
  scopeNote: string;
  programs: {
    code: string;
    name: string;
    objectives: string[];
    dailyRate: number | null;
    total: number | null;
    capacity: string;
  }[];
  total: number | null;
  priceNote: string;
};
export function buildConsultantProposal(
  detail: ConsultantDetail,
  raw: unknown,
  consultant: string,
) {
  const input = proposalInput.parse(raw),
    w = detail.workspace;
  if (!detail.record.canEdit)
    throw new ConsultantError("CONSULTANT_NOT_ASSIGNED", 403);
  if (!w || w.checklist_status !== "completed")
    throw new ConsultantError("CONSULTANT_CHECKLIST_REQUIRED", 409);
  const answers = validateSpinAnswers(
    { ...w.original_answers, ...w.answers },
    true,
  );
  const programs = input.programCodes.map((code) => {
    const p = SPIN_CATALOG.modules.find((p) => p.code === code);
    if (!p || (p.code === "SS-27" && answers.spiritualOptIn !== "yes"))
      throw new ConsultantError("CONSULTANT_PROGRAM_UNAVAILABLE", 400);
    // Catalog day rates cover up to 30 people. Larger groups require a reviewed quote.
    const rate = input.participants <= 30 ? p.dailyRateIdr : null;
    return {
      code: p.code,
      name: p.name,
      objectives: p.objectives.map((o) => o.text),
      dailyRate: rate,
      total: rate === null ? null : rate * input.days,
      capacity: p.capacity,
    };
  });
  const snapshot: ProposalSnapshot = {
    company: detail.record.company,
    name: detail.record.name,
    email: detail.record.email,
    consultant,
    issuedAt: new Date().toISOString(),
    summary: spinSummary(SPIN_DEFINITION, answers),
    days: input.days,
    participants: input.participants,
    venue: input.venue,
    location: input.location,
    scopeNote: input.scopeNote,
    programs,
    total: programs.some((p) => p.total === null)
      ? null
      : programs.reduce((s, p) => s + p.total!, 0),
    priceNote:
      "Estimasi tarif program = tarif harian × jumlah hari. Indoor/outdoor tidak menambah tarif program. Kebutuhan tambahan dan komponen yang belum ditetapkan ditampilkan sebagai (—), bukan Rp0. Ruang lingkup, pajak, perjalanan, akomodasi, dan fasilitas pelaksanaan perlu dikonfirmasi sebelum kesepakatan.",
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...snapshot,
        issuedAt: "",
        checklistRevision: w.checklist_revision,
        assignmentRevision: w.assignment_revision,
      }),
    )
    .digest("hex");
  return { snapshot, hash, version: input.version };
}
export async function storeConsultantProposal(
  actor: string,
  lead: string,
  detail: ConsultantDetail,
  raw: unknown,
) {
  const result = buildConsultantProposal(
    detail,
    raw,
    detail.record.assigneeName,
  );
  return consultantRPC("consultant_store_proposal", {
    p_actor: actor,
    p_lead: lead,
    p_version: result.version,
    p_hash: result.hash,
    p_snapshot: result.snapshot,
  });
}
