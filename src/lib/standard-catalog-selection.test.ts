import { describe, expect, it } from "vitest";
import { selectCatalogFallback } from "./standard-catalog-selection";

const candidates = [
  { code: "SS-08", name: "Kepemimpinan Adaptif", summary: "Memimpin perubahan", scope: "Pemimpin adaptif" },
  { code: "SS-12", name: "Kepercayaan dan Keamanan Psikologis", summary: "Membangun kepercayaan", scope: "Dialog terbuka dan resolusi konflik" },
  { code: "SS-13", name: "Sinergi Tim", summary: "Kolaborasi dan sinergi", scope: "Kolaborasi lintas fungsi" },
];

describe("catalog selection fallback", () => {
  it("selects a relevant official solution for conflict instead of an arbitrary cheap module", () => {
    expect(selectCatalogFallback({ locale: "id", challenge: "Sering terjadi konflik internal", target: "Tim semakin kompak", recommendations: [], candidates })?.moduleCodes).toEqual(["SS-12"]);
  });
  it("uses complete assessment recommendations when free text is absent", () => {
    expect(selectCatalogFallback({ locale: "en", challenge: "", target: "", recommendations: [{ title: "Build trust and psychological safety" }], candidates })?.moduleCodes).toEqual(["SS-12"]);
  });
  it("does not invent a solution for an unsupported need", () => {
    expect(selectCatalogFallback({ locale: "id", challenge: "Perlu pinjaman modal", target: "IPO", recommendations: [], candidates })).toBeNull();
  });
  it("never returns a mock or unknown catalog code", () => {
    expect(selectCatalogFallback({ locale: "id", challenge: "Konflik tim", target: "", recommendations: [], candidates: [{ ...candidates[1], code: "MOCK-01" }] })).toBeNull();
  });
});
