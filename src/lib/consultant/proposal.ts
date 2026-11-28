import "server-only";
import { createHash } from "node:crypto";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
import { SPIN_DEFINITION, validateSpinAnswers } from "@/lib/spin/intake";
import { spinSummary } from "@/lib/spin/form";
import { catalogContents } from "@/lib/spin/report";
import { consultantProgramCapacity, estimateConsultantProgram } from "./pricing";
import { ConsultantError, consultantRPC } from "./http";
import { proposalInput, type ConsultantDetail } from "./schemas";

export type ProposalSnapshot = {
  documentKind?: "formal";
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
  intendedSchedule?: string;
  nextStep?: string;
  pricedSubtotal?: number | null;
  additionalComponents?: { name: string; amountIdr: number | null }[];
  programs: {
    code: string;
    name: string;
    objectives: string[];
    dailyRate: number | null;
    total: number | null;
    capacity: string;
    priceBasis?: string;
    pricingSource?: "catalog" | "manual";
    components?: string[];
    outputs?: string[];
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
  const manualPrices = new Map(input.manualPrices?.map(({ code, amountIdr }) => [code, amountIdr]));
  if (input.manualPrices?.some(item => !input.programCodes.includes(item.code)))
    throw new ConsultantError("CONSULTANT_MANUAL_PRICE_UNEXPECTED", 400);

  const programs = input.programCodes.map((code) => {
    const p = SPIN_CATALOG.modules.find((p) => p.code === code);
    if (!p || (p.code === "SS-27" && answers.spiritualOptIn !== "yes"))
      throw new ConsultantError("CONSULTANT_PROGRAM_UNAVAILABLE", 400);
    const automatic = estimateConsultantProgram(p, input.participants, input.days);
    const manual = manualPrices.get(code);
    if (automatic && manual !== undefined)
      throw new ConsultantError("CONSULTANT_MANUAL_PRICE_UNEXPECTED", 400);
    if (automatic === null && manual === undefined)
      throw new ConsultantError("CONSULTANT_PROPOSAL_PRICE_REQUIRED", 422);
    return {
      code: p.code,
      name: p.name,
      objectives: p.objectives.map((o) => o.text),
      capacity: consultantProgramCapacity(p),
      ...catalogContents(p.sourceText),
      ...(automatic ?? {
        dailyRate: null,
        total: manual!,
        priceBasis: "Tarif program sesuai ruang lingkup pelaksanaan.",
        pricingSource: "manual" as const,
      }),
    };
  });
  const components = (input.additionalComponents ?? []).map(item => {
    if (item.amountIdr === null) throw new ConsultantError("CONSULTANT_PROPOSAL_PRICE_REQUIRED", 422);
    return { name: item.name, amountIdr: item.amountIdr };
  });
  const total = programs.reduce((sum, program) => sum + program.total, 0)
    + components.reduce((sum, item) => sum + item.amountIdr, 0);
  const snapshot: ProposalSnapshot = {
    documentKind: "formal",
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
    intendedSchedule: typeof answers.dates === "string" ? answers.dates : "",
    nextStep: input.nextStep || "Mohon konfirmasi ruang lingkup dan pilihan jadwal agar kami dapat menyiapkan kesepakatan pelaksanaan.",
    programs,
    pricedSubtotal: total,
    ...(components.length > 0 ? { additionalComponents: components } : {}),
    total,
    priceNote:
      "Total mencakup program dan komponen yang tercantum. Pajak dan perubahan cakupan dibahas bersama.",
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
