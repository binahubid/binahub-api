import { describe, expect, it } from "vitest";
import { buildPublicCatalog } from "./public-catalog";

describe("buildPublicCatalog", () => {
  it("groups published modules without exposing internal prices", () => {
    const result = buildPublicCatalog(
      [
        { id: "p1", product_key: "binainsight", slug: "binainsight", name: "BinaInsight", objective: "Diagnosis", short_description: "Diagnosis", public_description: "Description", cover_image_url: null, featured: true, display_order: 0 },
        { id: "p2", product_key: "empty", slug: "empty", name: "Empty", objective: null, short_description: null, public_description: null, cover_image_url: null, featured: false, display_order: 1 },
      ],
      [{
        id: "m1",
        product_id: "p1",
        module_code: "BI-PUBLIC",
        slug: "bi-public",
        name: "Public Assessment",
        description: "Free assessment",
        standard_scope: "Individual report",
        deliverables: "PDF report",
        out_of_scope: null,
        duration_label: "15 minutes",
        featured: true,
        display_order: 0,
        catalog_version: "v1",
      }],
    );

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("binainsight");
    expect(result[0].modules[0]).not.toHaveProperty("basePrice");
    expect(result[0].modules[0]).not.toHaveProperty("pricingUnit");
    expect(result[0].modules[0]).not.toHaveProperty("currency");
  });

  it("localizes a Signature Solution without serializing its commercial metadata", () => {
    const result = buildPublicCatalog([{
      id: "p1", product_key: "signature-self", slug: "signature-self", name: "Transformasi Diri",
      objective: null, short_description: null, public_description: "Pengembangan diri", cover_image_url: null,
      featured: false, display_order: 1,
    }], [{
      id: "m1", product_id: "p1", module_code: "SS-01", slug: "ss-01", name: "Kecerdasan Emosional",
      description: "Kenali diri", standard_scope: null, deliverables: null, out_of_scope: null,
      duration_label: "1 hari", featured: false, display_order: 1, catalog_version: "signature-2026-ceo-v1",
      metadata: {
        localized: { en: {
          name: "Emotional Intelligence", summary: "Understand yourself",
          tagline: "Understand Yourself. Connect Better.",
          learningObjectives: ["Build self-awareness."],
          contentOutline: ["Emotional patterns."],
          outputs: ["Personal action plan."],
          bestFor: "Professionals", engagementFormat: "Program", duration: "1 day", capacity: "Up to 30 pax",
          serviceBrand: "BinaLab", hiddenPrice: "Rp25,000,000",
        } },
        commercial: { internalPrice: 25_000_000 },
      },
    }], "en");
    expect(result[0].name).toBe("Self Transformation");
    expect(result[0].modules[0].name).toBe("Emotional Intelligence");
    expect(result[0].modules[0].description).toBe("Understand yourself");
    expect(result[0].modules[0].learningObjectives).toEqual(["Build self-awareness."]);
    expect(result[0].modules[0].contentOutline).toEqual(["Emotional patterns."]);
    expect(result[0].modules[0].outputs).toEqual(["Personal action plan."]);
    expect(JSON.stringify(result)).not.toMatch(/commercial|internalPrice|25000000|hiddenPrice|Rp25|metadata/i);
  });
  it("keeps the original English title with Indonesian body copy", () => {
    const result = buildPublicCatalog([{
      id: "p1", product_key: "signature-team", slug: "team", name: "Transformasi Tim", objective: null,
      short_description: null, public_description: "Kolaborasi tim", cover_image_url: null, featured: false, display_order: 1,
    }], [{
      id: "m1", product_id: "p1", module_code: "SS-13", slug: "synergy", name: "Sinergi Tim", description: "Penguatan tim",
      standard_scope: null, deliverables: null, out_of_scope: null, duration_label: "1 hari", featured: false, display_order: 1, catalog_version: "v1",
      metadata: { localized: { en: { name: "Team Synergy", summary: "Team alignment" }, id: { name: "Sinergi Tim", summary: "Menyelaraskan cara kerja tim", learningObjectives: ["Membangun kolaborasi"] } } },
    }], "id");
    expect(result[0].name).toBe("Team Transformation");
    expect(result[0].modules[0]).toMatchObject({ name: "Team Synergy", description: "Menyelaraskan cara kerja tim", learningObjectives: ["Membangun kolaborasi"] });
  });
});
