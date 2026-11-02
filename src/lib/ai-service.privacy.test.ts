import { beforeEach, describe, it, expect, vi } from "vitest";
const routed = vi.hoisted(() => vi.fn());
vi.mock("./ai-provider", () => ({ callRoutedAI: routed }));
import {
  selectStandardCatalogModules,
  analyzeAssessment,
  scoreLeadWithAI,
  refineLeadDiscoveryScoreWithAI,
  generateAssessmentProposal,
  generateInquiryFollowUp,
  generateInquiryReplyDraft,
  generateAssessmentFollowUp,
  generateProjectAutopilotPlan,
  matchAssociatesForProject,
  generateAssociateInvitation,
  extractLinkedInProfileFields,
  chatWithAI,
} from "./ai-service";
import { AssessmentSchema } from "./validations";

const person = "Ayu Identity Sentinel",
  company = "PT Company Sentinel",
  email = "ayu.sentinel@example.invalid",
  phone = "+62 812-3456-7890";
const details = { name: person, company, email };
const need = "Koordinasi tim terlambat dan perlu kejelasan peran.";
const contactText =
  need +
  " Hubungi " +
  person +
  " di " +
  email +
  " / " +
  phone +
  " https://example.invalid/private?token=never-send api_key=private-key-sentinel";
const prompt = () =>
  routed.mock.calls
    .at(-1)![0]
    .messages.find((m: { role: string }) => m.role === "user")
    .content as string;
const expectPrivate = () =>
  expect(JSON.stringify(routed.mock.calls.at(-1)![0])).not.toMatch(
    /Ayu Identity Sentinel|PT Company Sentinel|ayu\.sentinel@|812-3456|private-key-sentinel|never-send/,
  );
beforeEach(() => {
  routed.mockReset();
  routed.mockResolvedValue({
    content: "{}",
    provider: "lapakvip",
    model: "synthetic",
  });
});
describe("AI purpose-specific data projections (no provider calls)", () => {
  it("reapplies known identity minimization when a personalized analysis moves to catalog selection", async () => {
    routed.mockResolvedValue({
      content: JSON.stringify({
        moduleCodes: ["SS-08"],
        reasoning: "Kebutuhan kepemimpinan tim sesuai lingkup modul.",
      }),
    });
    await selectStandardCatalogModules({
      privateIdentities: [person, company],
      locale: "id",
      challenge: contactText,
      target: "Koordinasi lebih baik",
      category: "Developing",
      scores: { Leadership: 60 },
      recommendations: [
        {
          title: "Pengembangan untuk " + company,
          description: "Disiapkan untuk " + person,
        },
      ],
      candidates: [
        {
          code: "SS-08",
          name: "Kepemimpinan Adaptif",
          summary: "Adaptasi",
          scope: "Lingkup resmi",
          objectives: ["Adaptasi"],
          duration: "1 hari",
          serviceBrand: "BinaAcademy",
        },
      ],
    });
    expectPrivate();
    expect(prompt()).toContain("SS-08");
  });
  it("keeps deterministic team scores and business context while removing known identities", async () => {
    const data = AssessmentSchema.parse({
      ...details,
      whatsapp: phone,
      role: "HR Manager",
      employees: "100",
      challenge: contactText,
      target: "Kinerja koordinasi lebih baik",
      answers: Object.fromEntries(
        Array.from({ length: 49 }, (_, i) => [String(i + 1), 4]),
      ),
    });
    const before = JSON.stringify(data),
      result = await analyzeAssessment(data);
    expectPrivate();
    expect(prompt()).toContain(need);
    expect(prompt()).toContain("HR Manager");
    expect(result.scores.overall).toBe(80);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("uses factual lead fit evidence only, excluding injected record fields and contact data", async () => {
    routed.mockResolvedValue({
      content: JSON.stringify({
        adjustment: 0,
        reasoning: "Bukti kebutuhan organisasi sesuai.",
      }),
    });
    await refineLeadDiscoveryScoreWithAI({
      privateIdentities: [person],
      company,
      roleTitle: "HR",
      industry: "Perkebunan",
      location: "Jakarta",
      employeeCount: 100,
      organizationDescription: contactText,
      deterministicScore: 70,
      evidence: {
        industry: "Perkebunan",
        roleTitle: "HR",
        positiveSignals: ["Ekspansi", { private: "NESTED_PRIVATE_SIGNAL" }],
        employeeRange: { private: "NESTED_PRIVATE_RANGE" },
        email,
        rawProfile: "PRIVATE_PROFILE_SENTINEL",
        nested: { secret: "DO_NOT_SEND" },
      },
    });
    expectPrivate();
    expect(prompt()).not.toMatch(
      /PRIVATE_PROFILE_SENTINEL|DO_NOT_SEND|NESTED_PRIVATE/,
    );
    expect(prompt()).toContain("Ekspansi");
    expect(prompt()).toContain("Perkebunan");
    routed.mockResolvedValue({
      content: JSON.stringify({
        score: 30,
        status: "cold",
        reasoning: "Bukti terbatas.",
      }),
    });
    await scoreLeadWithAI({
      ...details,
      source: "inquiry",
      assessmentCompleted: false,
      challenge: contactText,
    });
    expectPrivate();
  });
  it("personalizes proposal locally while preserving catalog quantities and prices", async () => {
    routed.mockImplementation(async (input) => {
      const user = input.messages.find(
        (m: { role: string }) => m.role === "user",
      ).content;
      const name = /Nama: (\S+)/.exec(user)![1];
      return {
        content: JSON.stringify({
          subject: "Rencana pengembangan",
          opening: "Terima kasih " + name + ". Kebutuhan tim ditinjau bersama.",
          proposedProgram: "Program Koordinasi",
          scope: ["Lingkup resmi"],
          timeline: "Dikonfirmasi bersama",
          investmentNote: "Sesuai lingkup yang diberikan.",
          nextStep: "Diskusikan jadwal pelaksanaan.",
        }),
      };
    });
    const result = await generateAssessmentProposal({
      ...details,
      challenge: contactText,
      commercialContext: {
        items: [
          {
            name: "Program resmi",
            standardScope: "Lingkup resmi",
            quantity: 2,
            pricingUnit: "hari",
          },
        ],
        currency: "IDR",
        totalBeforeTax: 100000,
        isSimulation: false,
      },
    });
    expectPrivate();
    expect(result.opening).toContain(person);
    expect(result.packages[0].price).toContain("100.000");
    expect(result.packages[0].deliverables).toEqual([
      "Program resmi — 2 × hari",
    ]);
  });
  it.each(["inquiryFollowUp", "assessmentFollowUp", "inquiryReply"] as const)(
    "keeps %s contacts local and preserves draft shape",
    async (kind) => {
      routed.mockResolvedValue({
        content: JSON.stringify({
          subject: "Tindak lanjut kebutuhan tim",
          ...(kind === "inquiryReply"
            ? {
                body: "Mari bahas kebutuhan tim dan langkah pengembangan berikutnya.",
              }
            : { html: "<p>Diskusikan kebutuhan program berikutnya.</p>" }),
        }),
      });
      if (kind === "inquiryFollowUp")
        await generateInquiryFollowUp({
          ...details,
          message: contactText,
          level: 1,
        });
      else if (kind === "assessmentFollowUp")
        await generateAssessmentFollowUp({
          ...details,
          channel: "result",
          level: 1,
          aiAnalysis: contactText,
        });
      else
        await generateInquiryReplyDraft({ ...details, message: contactText });
      expectPrivate();
    },
  );
  it("does not send contact fields or the nested candidate list while planning a project", async () => {
    const project = {
      clientName: company,
      contactName: person,
      contactEmail: email,
      programName: "Koordinasi Tim",
      scope: contactText,
      associates: [
        {
          name: "OTHER_PRIVATE_PERSON",
          email: "other@example.invalid",
          notes: "PRIVATE_NOTES",
        },
      ],
    };
    await generateProjectAutopilotPlan(project);
    expectPrivate();
    expect(prompt()).not.toMatch(
      /OTHER_PRIVATE_PERSON|PRIVATE_NOTES|associates/,
    );
    expect(prompt()).toContain("Koordinasi Tim");
  });
  it("matches using transient refs and allowed qualifications, then restores identity from server records", async () => {
    const candidate = {
      id: "private-candidate-record",
      name: person,
      email,
      category: "Trainer",
      expertise: "Kolaborasi",
      field: "L&D",
      availability: "available",
      linkedinSummary: contactText,
      notes: "PRIVATE_NOTES",
      rate: "PRIVATE_BANK_DETAILS",
      unapproved: "PRIVATE_UNKNOWN",
    };
    const input = {
      project: {
        clientName: company,
        contactName: person,
        contactEmail: email,
        programName: "Program Tim",
        scope: need,
      },
      roles: [{ roleTitle: "Trainer", associateCategory: "Trainer" }],
      associates: [candidate],
    };
    routed.mockResolvedValue({
      content: JSON.stringify({
        matches: [
          {
            roleTitle: "Trainer",
            associateId: "candidate-1",
            associateName: "Forged",
            associateEmail: "forged@example.invalid",
            matchScore: 85,
            matchReason: "Keahlian kolaborasi sesuai kebutuhan.",
          },
        ],
      }),
    });
    const result = await matchAssociatesForProject(input);
    expectPrivate();
    expect(prompt()).not.toMatch(
      /private-candidate-record|PRIVATE_NOTES|PRIVATE_BANK_DETAILS|PRIVATE_UNKNOWN/,
    );
    expect(prompt()).toContain("Kolaborasi");
    expect(result[0]).toMatchObject({
      associateId: candidate.id,
      associateName: person,
      associateEmail: email,
      matchScore: 85,
    });
    routed.mockResolvedValue({
      content: JSON.stringify({
        matches: [
          {
            roleTitle: "Trainer",
            associateId: "candidate-99",
            matchScore: 100,
            matchReason: "Not a valid ref",
          },
        ],
      }),
    });
    expect((await matchAssociatesForProject(input))[0].associateId).toBe(
      candidate.id,
    );
  });
  it("minimizes invitation and LinkedIn contact context without changing the import shape", async () => {
    await generateAssociateInvitation({
      associateName: person,
      clientName: company,
      programName: "Program Tim",
      roleTitle: "Trainer",
      scope: contactText,
    });
    expectPrivate();
    await extractLinkedInProfileFields({
      linkedinUrl: "https://linkedin.com/in/private-identity",
      profileText: "Trainer berpengalaman. " + email + " " + phone,
    });
    expect(prompt()).not.toMatch(/private-identity|ayu\.sentinel@|812-3456/);
    expect(prompt()).toContain("Trainer berpengalaman");
  });
  it("keeps chat lead collection working locally without sending the actual email or private URL query", async () => {
    routed.mockImplementation(async (input) => {
      const last = input.messages.at(-1).content;
      const ref = last.match(/__BH_PRIVATE_[a-f0-9]+_\d+__/)[0];
      return {
        content: JSON.stringify({
          tool: "save_chat_lead",
          args: { name: "Nama dari percakapan", email: ref },
        }),
      };
    });
    const result = await chatWithAI("Email saya " + email, [], {
      currentPath: "/discovery?token=URL_QUERY_SENTINEL#invite=private",
      locale: "id",
    });
    expect(JSON.stringify(routed.mock.calls[0][0])).not.toMatch(
      /ayu\.sentinel@|URL_QUERY_SENTINEL/,
    );
    expect(JSON.parse(result).args.email).toBe(email);
  });
  it("rejects foreign or corrupted private references during provider validation, not after delivery", async () => {
    routed.mockImplementation(async (input) => {
      expect(() =>
        input.validateContent('{"reply":"__BH_PRIVATE_corrupted__"}'),
      ).toThrow("AI_PRIVATE_REFERENCE_INVALID");
      const ref = input.messages
        .at(-1)
        .content.match(/__BH_PRIVATE_[a-f0-9]+_\d+__/)[0];
      const content = JSON.stringify({
        tool: "save_chat_lead",
        args: { email: ref },
      });
      expect(() => input.validateContent(content)).not.toThrow();
      return { content };
    });
    expect(
      JSON.parse(await chatWithAI("Email saya " + email, [])).args.email,
    ).toBe(email);
    expectPrivate();
  });
});
