import { describe, expect, it } from "vitest";
import { renderApprovedOutreachHtml } from "./email-template-renderer";

describe("approved outreach email rendering", () => {
  it("preserves approved formatting and HTTPS CTA links", () => {
    const html = renderApprovedOutreachHtml(
      '<p>Halo <strong>Bapak/Ibu</strong></p><a href="https://binahub.id/diagnosa">Coba diagnosa</a>',
    );

    expect(html).toContain("<strong>Bapak/Ibu</strong>");
    expect(html).toContain('href="https://binahub.id/diagnosa"');
    expect(html).toContain("Coba diagnosa");
    expect(html).toContain("Bina<span");
    expect(html).toContain("PT Binahub Solusi Transformasi");
    expect(html).toContain("www.binahub.id");
  });

  it("removes executable elements, event handlers, and unsafe URL protocols", () => {
    const html = renderApprovedOutreachHtml(
      '<script>alert(1)</script><p onclick="alert(2)">Aman</p><a href="javascript:alert(3)">Tautan</a>',
    );

    expect(html).not.toMatch(/<script|onclick|javascript:/i);
    expect(html).toContain("Aman");
  });
});
