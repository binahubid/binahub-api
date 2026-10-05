import { describe, expect, it } from "vitest";
import { proposalRequestPage } from "./proposal-request-page";

describe("public proposal request copy", () => {
  it("only confirms receipt without exposing internal pricing or AI gates", () => {
    const page = proposalRequestPage({ state: "received" });
    expect(page).toContain("Permintaan proposal diterima");
    expect(page).toContain("Proposal akan dikirim ke email Anda");
    expect(page).not.toMatch(/tervalidasi|lolos validasi|harga dasar|modul standar|persetujuan|katalog resmi/);
    expect(page).not.toContain("<form");
  });
  it("has immediate accessible loading feedback and duplicate-submit protection", () => {
    const page = proposalRequestPage({ state: "confirm", action: "/api/proposal/request?token=test" });
    expect(page).toContain('role="status"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("button.disabled=true");
    expect(page).toContain("event.preventDefault()");
    expect(page).toContain("Mengirim permintaan…");
    expect(page).toContain("@keyframes spin");
    expect(page).toContain("prefers-reduced-motion");
    expect(page).not.toContain("fonts.googleapis.com");
  });
  it("escapes error text and form actions", () => {
    expect(proposalRequestPage({ state: "error", message: '<script>alert(1)</script>' })).not.toContain('<script>alert(1)</script>');
    expect(proposalRequestPage({ state: "confirm", action: '/request?token=" onmouseover="alert(1)' })).toContain("&quot;");
  });
  it("supports English without technical explanation", () => {
    expect(proposalRequestPage({ locale: "en", state: "received" })).toContain("Proposal request received");
  });
});
