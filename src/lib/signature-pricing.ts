export const INCLUDED_SIGNATURE_PARTICIPANTS = 30;
export const SIGNATURE_PRICING_VERSION = "signature-pricing-2026-11-28";

type CatalogRate = { code: string; dailyRateIdr: number | null };

export function signatureDailyPricing(program: CatalogRate) {
  const teamBuilding = program.code === "SS-11";
  const dailyRateIdr = teamBuilding ? 25_000_000 : program.dailyRateIdr;
  if (dailyRateIdr === null) return null;
  return {
    dailyRateIdr,
    additionalParticipantRateIdr: teamBuilding ? 700_000 : 1_000_000,
    includedParticipants: INCLUDED_SIGNATURE_PARTICIPANTS,
    halfDayMinimum: teamBuilding,
  };
}

export function signatureDayRate(
  pricing: NonNullable<ReturnType<typeof signatureDailyPricing>>,
  participants: number,
) {
  const extraParticipants = Math.max(0, participants - pricing.includedParticipants);
  return pricing.dailyRateIdr + extraParticipants * pricing.additionalParticipantRateIdr;
}
