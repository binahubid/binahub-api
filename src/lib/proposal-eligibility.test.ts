import { describe, expect, it } from "vitest";
import { evaluateAssessmentProposalEligibility, evaluateInquiryProposalEligibility } from "./proposal-eligibility";

const scores = {
  Insights: 72,
  Lab: 68,
  Coach: 64,
  Play: 70,
  Academy: 61,
  Works: 66,
  Impact: 58,
  overall: 66,
};

const recommendations = ["Lab", "Coach", "Impact"].map((service) => ({
  title: `Perkuat ${service}`,
  description: `Jalankan intervensi terarah untuk memperkuat area ${service} berdasarkan hasil diagnosis.`,
  service,
}));
const answers = Object.fromEntries(Array.from({ length: 49 }, (_, index) => [String(index + 1), (index % 5) + 1]));

describe("proposal eligibility", () => {
  it("accepts a complete assessment", () => {
    const result = evaluateAssessmentProposalEligibility({
      formData: {
        name: "Gerry Sujono",
        email: "gerry@example.com",
        company: "PT Uji Kelayakan Jalan",
        challenge: "Kolaborasi lintas fungsi belum konsisten ketika prioritas berubah.",
        answers,
      },
      scores,
      category: "Profesional",
      aiAnalysis: "Analisis lintas dimensi menunjukkan fondasi yang kuat, tetapi ritme eksekusi dan pembagian keputusan masih perlu dibuat lebih konsisten.",
      recommendations,
      overallScore: 66,
    });
    expect(result).toMatchObject({ eligible: true, missing: [] });
  });

  it("blocks an incomplete assessment and explains why", () => {
    const result = evaluateAssessmentProposalEligibility({
      formData: { name: "A", email: "invalid", company: "" },
      scores: { overall: 40 },
      category: null,
      aiAnalysis: "pendek",
      recommendations: [],
      overallScore: 40,
    });
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain("skor seluruh dimensi assessment");
    expect(result.missing).toContain("minimal tiga rekomendasi lengkap");
  });

  it("requires a clear inquiry before enabling an AI draft", () => {
    expect(evaluateInquiryProposalEligibility({
      name: "Rina",
      email: "rina@example.com",
      company: "PT Contoh",
      message: "Kami membutuhkan program kepemimpinan bagi 40 supervisor pada kuartal berikutnya.",
    }).eligible).toBe(true);
    expect(evaluateInquiryProposalEligibility({
      name: "Rina",
      email: "rina@example.com",
      company: "PT Contoh",
      message: "Minta info",
    }).eligible).toBe(false);
  });
});
