import { describe, expect, it } from "vitest";
import { qualifyLead } from "./lead-qualification";

describe("confirmed lead qualification", () => {
  it("requires all mandatory Hot conditions even when the numeric score is high", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: "100-250",
      role: "CEO",
      challenge: "Produktivitas tim turun dan menghambat target pertumbuhan perusahaan.",
      target: "Membangun pola kerja yang lebih konsisten dalam enam bulan.",
      timelineKnown: true,
      budgetKnown: true,
      meetingIntent: false,
      businessConsequenceKnown: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.temperature).toBe("warm");
    expect(result.missingData).toContain("nextStepOrMeeting");
  });

  it("classifies a qualified decision-maker with at least three signals as Hot", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: "50-99",
      role: "HR Director",
      challenge: "Leadership pipeline belum siap dan mulai menghambat ekspansi bisnis.",
      target: "Menyiapkan pemimpin lini untuk dua unit baru dalam tahun berjalan.",
      industry: "Manufacturing",
      location: "Bekasi",
      timelineKnown: true,
      budgetKnown: true,
      meetingIntent: true,
      businessConsequenceKnown: true,
    });

    expect(result).toMatchObject({ temperature: "hot", eligible: true });
    expect(result.buyingSignalCount).toBeGreaterThanOrEqual(3);
  });

  it("does not penalize a public assessment for budget and sponsor questions that were not asked", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: "50-99",
      role: "HR Manager",
      challenge: "Produktivitas tim turun dan menghambat target pertumbuhan perusahaan.",
      target: "Membangun pola kerja yang lebih konsisten dalam enam bulan.",
      industry: "Teknologi",
      location: "Jakarta",
      timelineKnown: true,
      meetingIntent: true,
      businessConsequenceKnown: true,
    });

    expect(result.temperature).toBe("hot");
    expect(result.confidence).toBe(1);
    expect(result.missingData).not.toContain("budget");
  });

  it("still respects an explicitly unconfirmed sponsor on legacy submissions", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: "50-99",
      role: "HR Manager",
      challenge: "Produktivitas tim turun dan menghambat target pertumbuhan perusahaan.",
      target: "Membangun pola kerja yang lebih konsisten dalam enam bulan.",
      timelineKnown: true,
      sponsorKnown: false,
      budgetKnown: true,
      meetingIntent: true,
      businessConsequenceKnown: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.temperature).toBe("warm");
  });

  it("does not guess eligibility from an employee range crossing the minimum", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: "1 - 49",
      role: "L&D Manager",
      challenge: "Tim membutuhkan penguatan kemampuan manajerial untuk mendukung perubahan organisasi.",
      target: "Membentuk standar kepemimpinan yang konsisten di seluruh fungsi.",
    });

    expect(result.indicators.companySize).toBe("unknown");
    expect(result.missingData).toContain("companySizeConfirmation");
  });

  it("holds excluded industries even when commercial signals are strong", () => {
    const result = qualifyLead({
      assessmentCompleted: true,
      employees: 200,
      role: "CEO",
      challenge: "Organisasi membutuhkan transformasi kepemimpinan dengan dampak bisnis yang jelas.",
      target: "Meningkatkan kesiapan pemimpin dalam satu kuartal.",
      industry: "Pinjaman online",
      location: "Jakarta",
      timelineKnown: true,
      budgetKnown: true,
      meetingIntent: true,
      businessConsequenceKnown: true,
    });

    expect(result).toMatchObject({ eligible: false, temperature: "cold" });
    expect(result.exclusionReasons[0]).toContain("Pinjaman online");
  });
});
