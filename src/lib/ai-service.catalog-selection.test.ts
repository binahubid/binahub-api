import { beforeEach, describe, expect, it, vi } from "vitest";

const routed = vi.hoisted(() => vi.fn());
vi.mock("./ai-provider", () => ({ callRoutedAI: routed }));
import { selectStandardCatalogModules } from "./ai-service";

const input = {
  locale: "id" as const,
  challenge: "Pemimpin tim perlu beradaptasi",
  target: "Meningkatkan kepemimpinan adaptif",
  category: "Berkembang",
  scores: { Leadership: 43 },
  recommendations: [{ title: "Perkuat kepemimpinan", service: "Academy" }],
  candidates: [{ code: "SS-08", name: "Kepemimpinan Adaptif", summary: "Pimpin perubahan", scope: "Scope CEO", objectives: ["Adaptasi"], duration: "1 hari", serviceBrand: "BinaAcademy" }],
};

describe("AI catalog selection boundary", () => {
  beforeEach(() => routed.mockReset());

  it("accepts only a code in the approved candidate set", async () => {
    routed.mockImplementation(async () => {
      const content = JSON.stringify({ moduleCodes: ["SS-08"], reasoning: "Rekomendasi leadership cocok dengan modul adaptif yang tersedia." });
      return { provider: "lapakvip", model: "test", content };
    });
    await expect(selectStandardCatalogModules(input)).resolves.toMatchObject({ moduleCodes: ["SS-08"] });
  });

  it("rejects a hallucinated catalog code before a proposal can be sent", async () => {
    routed.mockImplementation(async () => {
      const content = JSON.stringify({ moduleCodes: ["SS-99"], reasoning: "Rekomendasi leadership cocok dengan modul adaptif yang tersedia." });
      return { provider: "lapakvip", model: "test", content };
    });
    await expect(selectStandardCatalogModules(input)).rejects.toThrow("di luar daftar");
  });
});
