import { SPIN_CATALOG, type SpinCatalogModule } from "@/lib/spin/catalog";
import type { ProposalSnapshot } from "./proposal";

const teamBuildingCapacity = { essentialIncluded: 30, essentialMax: 40, signatureMax: 80, enterpriseIncluded: 150 };

function usesTeamBuildingPackages(program: SpinCatalogModule) {
  return program.code === "SS-11" && program.pricingModel === "Paket Standar";
}

export function consultantProgramCapacity(program: SpinCatalogModule) {
  if (!usesTeamBuildingPackages(program)) return program.capacity;
  const { essentialIncluded, essentialMax, signatureMax, enterpriseIncluded } = teamBuildingCapacity;
  return `Essential: ${essentialIncluded} peserta termasuk, tambahan hingga ${essentialMax}. Signature: ${essentialMax + 1}–${signatureMax}. Enterprise: ${signatureMax + 1}–${enterpriseIncluded}.`;
}

export function requiresProposalPriceRefresh(snapshot: unknown) {
  const value = snapshot as Partial<ProposalSnapshot> | null;
  if (!value?.days || !value.participants || !Array.isArray(value.programs)) return false;
  const { participants, days } = value;
  return value.programs.some(line => {
    if (line.total !== null && line.code !== "SS-11") return false;
    const program = SPIN_CATALOG.modules.find(item => item.code === line.code);
    if (!program) return false;
    const { total } = estimateConsultantProgram(program, participants, days);
    return total !== null && total !== line.total;
  });
}

export const proposalMoney = (amount: number) => "Rp" + amount.toLocaleString("id-ID");

/** Estimate from the approved catalog. Venue and unpriced extras are excluded. */
export function estimateConsultantProgram(program: SpinCatalogModule, participants: number, days: number) {
  if (usesTeamBuildingPackages(program)) {
    // The same per-person surcharge applies to the approved Essential extension and Enterprise overflow.
    const [essential, signature, enterprise, extra] = [...program.priceEvidence.matchAll(/Rp([\d.]+)/g)]
      .map(([, amount]) => Number(amount.replace(/\./g, "")));
    if ([essential, signature, enterprise, extra].every(amount => Number.isSafeInteger(amount) && amount > 0)
      && [0.5, 1, 2].includes(days)) {
      const { essentialIncluded, essentialMax, signatureMax, enterpriseIncluded } = teamBuildingCapacity;
      const useEssential = participants <= essentialMax;
      const useSignature = !useEssential && participants <= signatureMax;
      const tier = useEssential ? "Essential" : useSignature ? "Signature" : "Enterprise";
      const base = useEssential ? essential : useSignature ? signature : enterprise;
      const included = useEssential ? essentialIncluded : useSignature ? signatureMax : enterpriseIncluded;
      const additional = Math.max(0, participants - included);
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
