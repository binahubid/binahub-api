import { SPIN_CATALOG, type SpinCatalogModule } from "@/lib/spin/catalog";
import { signatureDailyPricing, signatureDayRate } from "@/lib/signature-pricing";
import type { ProposalSnapshot } from "./proposal";

export function consultantProgramCapacity(program: SpinCatalogModule) {
  const pricing = signatureDailyPricing(program);
  return pricing ? `Termasuk hingga ${pricing.includedParticipants} peserta` : program.capacity;
}

export function requiresProposalPriceRefresh(snapshot: unknown) {
  const value = snapshot as Partial<ProposalSnapshot> | null;
  if (!value?.days || !value.participants || !Array.isArray(value.programs)) return false;
  if (value.total == null || value.additionalComponents?.some(item => item.amountIdr == null)) return true;
  const { participants, days } = value;
  return value.programs.some(line => {
    if (line.total == null || !Number.isSafeInteger(line.total) || line.total <= 0) return true;
    if (line.pricingSource === "manual") return false;
    const program = SPIN_CATALOG.modules.find(item => item.code === line.code);
    if (!program) return false;
    return estimateConsultantProgram(program, participants, days)?.total !== line.total;
  });
}

export const proposalMoney = (amount: number) => "Rp" + amount.toLocaleString("id-ID");

/** Estimate program delivery separately from additional components. */
export function estimateConsultantProgram(program: SpinCatalogModule, participants: number, days: number) {
  const pricing = signatureDailyPricing(program);
  const billedDays = days === 0.5 && pricing?.halfDayMinimum ? 1 : days;
  if (!pricing || !Number.isInteger(billedDays)) return null;

  const extra = Math.max(0, participants - pricing.includedParticipants);
  const base = proposalMoney(pricing.dailyRateIdr);
  const perDay = extra
    ? `(${base} + ${extra} peserta × ${proposalMoney(pricing.additionalParticipantRateIdr)})`
    : base;
  return {
    dailyRate: pricing.dailyRateIdr,
    total: signatureDayRate(pricing, participants) * billedDays,
    priceBasis: `${perDay} × ${billedDays} hari${days === 0.5 ? " (tarif minimum)" : ""}`,
    pricingSource: "catalog" as const,
  };
}
