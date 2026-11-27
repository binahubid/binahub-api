import { SPIN_CATALOG, type SpinCatalogModule } from "@/lib/spin/catalog";
import type { ProposalSnapshot } from "./proposal";

export function requiresProposalPriceRefresh(snapshot: unknown) {
  const value = snapshot as Partial<ProposalSnapshot> | null;
  if (!value || value.documentKind === "formal" || !value.days || !value.participants || !Array.isArray(value.programs)) return false;
  return value.programs.some(line => {
    if (line.total !== null) return false;
    const program = SPIN_CATALOG.modules.find(p => p.code === line.code);
    return program && estimateConsultantProgram(program, value.participants!, value.days!).total !== null;
  });
}

export const proposalMoney = (amount: number) => "Rp" + amount.toLocaleString("id-ID");

/** Estimate from the approved catalog. Venue and unpriced extras are excluded. */
export function estimateConsultantProgram(program: SpinCatalogModule, participants: number, days: number) {
  if (program.code === "SS-11" && program.pricingModel === "Paket Standar") {
    // The catalog lists Essential, Signature, Enterprise, then the surcharge above 150.
    const [essential, signature, enterprise, extra] = [...program.priceEvidence.matchAll(/Rp([\d.]+)/g)]
      .map(([, amount]) => Number(amount.replace(/\./g, "")));
    if ([essential, signature, enterprise, extra].every(amount => Number.isSafeInteger(amount) && amount > 0)
      && [0.5, 1, 2].includes(days)) {
      const tier = participants <= 30 ? "Essential" : participants <= 80 ? "Signature" : "Enterprise";
      const base = participants <= 30 ? essential : participants <= 80 ? signature : enterprise;
      const additional = Math.max(0, participants - 150);
      const rate = base + additional * extra;
      const packageLabel = additional
        ? `Paket ${tier} ${proposalMoney(base)} + ${additional} peserta × ${proposalMoney(extra)}`
        : `Paket ${tier} · ${proposalMoney(base)}`;
      return {
        dailyRate: null,
        total: rate * Math.max(1, days),
        priceBasis: days === 2 ? `(${packageLabel}) × 2 hari` : packageLabel,
      };
    }
    return { dailyRate: null, total: null, priceBasis: "Tarif paket Team Building perlu disesuaikan dengan durasi dan ruang lingkup." };
  }
  if (program.dailyRateIdr === null) {
    return { dailyRate: null, total: null, priceBasis: "Investasi ditetapkan setelah ruang lingkup disepakati." };
  }
  if (!Number.isInteger(days)) {
    return { dailyRate: null, total: null, priceBasis: "Durasi tidak memakai kelipatan tarif satu hari." };
  }
  const rate = program.dailyRateIdr;
  const batches = Math.ceil(participants / 30);
  const batchNote = batches > 1 ? ` × ${batches} batch (maksimal 30 peserta per batch)` : "";
  return {
    dailyRate: rate,
    total: rate * days * batches,
    priceBasis: `${proposalMoney(rate)} per hari × ${days} hari${batchNote}`,
  };
}
