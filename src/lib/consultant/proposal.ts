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
  const programs = input.programCodes.map((code) => {
    const p = SPIN_CATALOG.modules.find((p) => p.code === code);
    if (!p || (p.code === "SS-27" && answers.spiritualOptIn !== "yes"))
      throw new ConsultantError("CONSULTANT_PROGRAM_UNAVAILABLE", 400);
    return {
      code: p.code,
      name: p.name,
      objectives: p.objectives.map((o) => o.text),
      capacity: consultantProgramCapacity(p),
      ...catalogContents(p.sourceText),
      ...estimateConsultantProgram(p, input.participants, input.days),
    };
  });
  const components = input.additionalComponents ?? [];
  const amounts = [...programs.map(program => program.total), ...components.map(item => item.amountIdr)];
  const pricedAmounts = amounts.filter(amount => amount !== null);
  const pricedSubtotal = pricedAmounts.length
    ? pricedAmounts.reduce((subtotal, amount) => subtotal + amount, 0) : null;
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
    pricedSubtotal,
    ...(components.length > 0 ? { additionalComponents: components } : {}),
    total: pricedAmounts.length === amounts.length ? pricedSubtotal : null,
    priceNote:
      "Estimasi memakai tarif katalog yang berlaku untuk format indoor dan outdoor. Pajak dan biaya di luar rincian ini dikonfirmasi sesuai kebutuhan.",
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
