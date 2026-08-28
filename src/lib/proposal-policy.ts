export type ProposalGateReason = {
  code: string;
  message: string;
  severity: "warning" | "blocking";
};

export type ProposalRules = {
  version: string;
  isMock: boolean;
  currency: string;
  minimumTransaction: number;
  proposalValidityDays: number;
  humanGate: {
    alwaysRequireApprovalForMock: boolean;
    allowStandardAutoSend: boolean;
    highDealThreshold: number;
    maxDiscountWithoutApproval: number;
    absoluteMaxDiscount: number;
    lowConfidenceThreshold: number;
  };
};

export type ProposalModuleInput = {
  id: string;
  moduleCode: string;
  productKey: string;
  name: string;
  standardScope?: string | null;
  pricingUnit: string;
  basePrice: number;
  quantity: number;
  readinessStatus: string;
  isMock: boolean;
  catalogVersion: string;
};

export const DEFAULT_MOCK_PROPOSAL_RULES: ProposalRules = {
  version: "v0.1-mock",
  isMock: true,
  currency: "IDR",
  minimumTransaction: 25_000_000,
  proposalValidityDays: 14,
  humanGate: {
    alwaysRequireApprovalForMock: true,
    allowStandardAutoSend: false,
    highDealThreshold: 150_000_000,
    maxDiscountWithoutApproval: 5,
    absoluteMaxDiscount: 10,
    lowConfidenceThreshold: 0.75,
  },
};

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeProposalRules(row?: { version?: string; is_mock?: boolean; rules?: unknown } | null): ProposalRules {
  const raw = row?.rules && typeof row.rules === "object" && !Array.isArray(row.rules)
    ? row.rules as Record<string, unknown>
    : {};
  const gate = raw.humanGate && typeof raw.humanGate === "object" && !Array.isArray(raw.humanGate)
    ? raw.humanGate as Record<string, unknown>
    : {};

  return {
    version: row?.version || DEFAULT_MOCK_PROPOSAL_RULES.version,
    isMock: row?.is_mock ?? DEFAULT_MOCK_PROPOSAL_RULES.isMock,
    currency: typeof raw.currency === "string" ? raw.currency : DEFAULT_MOCK_PROPOSAL_RULES.currency,
    minimumTransaction: finiteNumber(raw.minimumTransaction, DEFAULT_MOCK_PROPOSAL_RULES.minimumTransaction),
    proposalValidityDays: finiteNumber(raw.proposalValidityDays, DEFAULT_MOCK_PROPOSAL_RULES.proposalValidityDays),
    humanGate: {
      alwaysRequireApprovalForMock: typeof gate.alwaysRequireApprovalForMock === "boolean"
        ? gate.alwaysRequireApprovalForMock
        : DEFAULT_MOCK_PROPOSAL_RULES.humanGate.alwaysRequireApprovalForMock,
      allowStandardAutoSend: typeof gate.allowStandardAutoSend === "boolean"
        ? gate.allowStandardAutoSend
        : DEFAULT_MOCK_PROPOSAL_RULES.humanGate.allowStandardAutoSend,
      highDealThreshold: finiteNumber(gate.highDealThreshold, DEFAULT_MOCK_PROPOSAL_RULES.humanGate.highDealThreshold),
      maxDiscountWithoutApproval: finiteNumber(gate.maxDiscountWithoutApproval, DEFAULT_MOCK_PROPOSAL_RULES.humanGate.maxDiscountWithoutApproval),
      absoluteMaxDiscount: finiteNumber(gate.absoluteMaxDiscount, DEFAULT_MOCK_PROPOSAL_RULES.humanGate.absoluteMaxDiscount),
      lowConfidenceThreshold: finiteNumber(gate.lowConfidenceThreshold, DEFAULT_MOCK_PROPOSAL_RULES.humanGate.lowConfidenceThreshold),
    },
  };
}

export function calculateProposalCommercials(modules: ProposalModuleInput[], discountPercent: number) {
  const items = modules.map((module) => ({
    ...module,
    lineTotal: Math.round(module.basePrice * module.quantity),
  }));
  const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
  const discountAmount = Math.round(subtotal * (discountPercent / 100));
  return {
    items,
    subtotal,
    discountPercent,
    discountAmount,
    totalBeforeTax: Math.max(0, subtotal - discountAmount),
  };
}

export function evaluateProposalGate(input: {
  rules: ProposalRules;
  modules: ProposalModuleInput[];
  totalBeforeTax: number;
  discountPercent: number;
  scopeType: "standard" | "custom";
  aiConfidence?: number;
  riskFlags?: string[];
  requiredDataComplete: boolean;
}) {
  const reasons: ProposalGateReason[] = [];
  const add = (code: string, message: string, severity: ProposalGateReason["severity"] = "blocking") => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, message, severity });
  };

  if (input.rules.isMock && input.rules.humanGate.alwaysRequireApprovalForMock) {
    add("MOCK_RULES", "Business Rules masih menggunakan data mock.");
  }
  if (input.modules.some((module) => module.isMock)) {
    add("MOCK_MODULE", "Proposal memuat modul mock yang belum menjadi katalog resmi.");
  }
  if (input.modules.some((module) => module.readinessStatus !== "ready")) {
    add("MODULE_NOT_READY", "Satu atau lebih modul belum berstatus siap dijual.");
  }
  if (input.scopeType === "custom") add("CUSTOM_SCOPE", "Scope custom wajib ditinjau manusia.");
  if (input.totalBeforeTax > input.rules.humanGate.highDealThreshold) {
    add("HIGH_DEAL_VALUE", "Nilai proposal melewati batas review manusia.");
  }
  if (input.discountPercent > input.rules.humanGate.maxDiscountWithoutApproval) {
    add("DISCOUNT_APPROVAL", "Diskon melewati batas tanpa persetujuan.");
  }
  if (input.discountPercent > input.rules.humanGate.absoluteMaxDiscount) {
    add("DISCOUNT_LIMIT_EXCEEDED", "Diskon melewati batas maksimum absolut.");
  }
  if (typeof input.aiConfidence === "number" && input.aiConfidence < input.rules.humanGate.lowConfidenceThreshold) {
    add("LOW_AI_CONFIDENCE", "Confidence AI berada di bawah threshold review.");
  }
  if (!input.requiredDataComplete) add("INCOMPLETE_DATA", "Data minimum proposal belum lengkap.");
  if ((input.riskFlags || []).length > 0) add("RISK_FLAG", "Terdapat risiko yang harus ditinjau manusia.");
  if (!input.rules.humanGate.allowStandardAutoSend) {
    add("AUTO_SEND_DISABLED", "Pengiriman otomatis belum diizinkan oleh Business Rules.", "warning");
  }

  return {
    status: reasons.length > 0 ? "pending_approval" as const : "clear" as const,
    reasons,
    canAutoSend: reasons.length === 0 && input.rules.humanGate.allowStandardAutoSend,
  };
}

export function formatIdr(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}
