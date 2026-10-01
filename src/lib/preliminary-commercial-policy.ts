export const AUTOMATIC_PRELIMINARY_APPROVAL_CEILING_IDR = 100_000_000;

export function automaticPreliminaryCommercialEligibility(items: Array<{ basePrice: number; quantity: number }>) {
  if (items.length === 0) return { eligible: false, reason: "Belum ada solusi resmi yang dipilih." };
  if (items.some((item) => !Number.isFinite(item.basePrice) || item.basePrice <= 0 || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    return { eligible: false, reason: "Satu atau lebih solusi belum memiliki harga standar yang disetujui." };
  }
  const total = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);
  if (total > AUTOMATIC_PRELIMINARY_APPROVAL_CEILING_IDR) {
    return { eligible: false, reason: "Investasi indikatif melewati Rp100.000.000 dan memerlukan persetujuan internal." };
  }
  return { eligible: true, reason: "", total };
}
