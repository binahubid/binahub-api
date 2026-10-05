// Presentation-only cleanup for previously stored proposal narratives.
// Never changes proposal classification, prices, quantities, dates, or approval rules.
export function clientProposalText(value: string): string {
  return value
    .replace(/\bproposal\s+(?:standar(?:d)?|custom)(?:\s+(?:atau|or)\s+(?:standar(?:d)?|custom))?/gi, "Proposal")
    .replace(/\b(?:standard|custom)\s+(?:solution\s+)?proposal\b/gi, "Proposal")
    .replace(/\b(?:harga dasar katalog|harga katalog dasar|harga dasar ini)\b/gi, "Investasi program")
    .replace(/\b(?:standard\s+)?catalog\s+base\s+price\b/gi, "Program investment")
    .replace(/\b(?:cakupan standar katalog|ruang lingkup standar katalog)\b/gi, "Cakupan program")
    .replace(/\bstandard catalog scope\b/gi, "Program scope")
    .replace(/\bsnapshot katalog(?: resmi| mock)?\b/gi, "rincian program")
    .replace(/\bcatalog snapshot\b/gi, "program details")
    .replace(/\b(?:katalog resmi|katalog dasar)\b/gi, "program BinaHub")
    .replace(/\b(?:selected\s+)?catalog solutions\b/gi, "selected solutions")
    .replace(/\bDurasi katalog\b/gi, "Durasi program")
    .replace(/\bCatalog duration\b/gi, "Program duration")
    .replace(/\bHari pelaksanaan yang dihargai\b/gi, "Rencana pelaksanaan")
    .replace(/\bPriced delivery days\b/gi, "Planned delivery")
    .replace(/\b(?:scope|cakupan|ruang lingkup) standar\b/gi, "ruang lingkup program")
    .replace(/\bstandard scope\b/gi, "program scope")
    .replace(/\b(?:solusi|program|modul) (?:standar|custom)\b/gi, "program")
    .replace(/\b(?:standard|custom) solution\b/gi, "solution")
    .replace(/\b(?:konfirmasi|persetujuan|peninjauan) manusia\b/gi, "konfirmasi bersama")
    .replace(/\bhuman (?:confirmation|approval|review)\b/gi, "confirmation")
    .trim();
}

const narrativeFields = new Set(["subject", "opening", "proposedProgram", "timeline", "investmentNote", "nextStep", "name", "nameEn", "focus", "focusEn", "bestFor", "duration"]);
const listFields = new Set(["scope", "deliverables", "learningObjectives"]);

export function clientProposalCopy<T extends object>(proposal: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      narrativeFields.has(key) && typeof child === "string" ? clientProposalText(child)
        : listFields.has(key) && Array.isArray(child) ? child.map((item) => typeof item === "string" ? clientProposalText(item) : item)
        : visit(child),
    ]));
  };
  return visit(proposal) as T;
}
