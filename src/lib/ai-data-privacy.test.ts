import { describe, it, expect } from "vitest";
import { AIPrivacyBoundary, withoutAISecrets } from "./ai-data-privacy";

describe("request-local AI minimization", () => {
  it("replaces known identities, contacts, private URLs and credentials without changing useful context", () => {
    const privacy = new AIPrivacyBoundary(["Ayu Sentinel", "PT Sentinel"]);
    const text = privacy.protect(
      "Ayu Sentinel dari PT Sentinel. email ayu@example.invalid; HP +62 812-3456-7890. https://example.invalid/private?token=private. Bearer testcredential. api_key=very-private. Kolaborasi 30 peserta, 2026-11-02, skor 75.",
    );
    expect(text).not.toMatch(
      /Ayu Sentinel|PT Sentinel|ayu@example|812-3456|https:|testcredential|very-private/,
    );
    expect(text).toContain("Kolaborasi 30 peserta, 2026-11-02, skor 75");
    expect(privacy.restore(text)).toContain("Ayu Sentinel");
    expect(privacy.restore(text)).toContain("ayu@example.invalid");
    expect(privacy.restore(text)).not.toMatch(
      /testcredential|very-private|https:/,
    );
  });
  it("restores JSON string values safely, never object keys or another request map", () => {
    const privacy = new AIPrivacyBoundary(['Ayu "Sentinel"']),
      original = 'Ayu "Sentinel"';
    const alias = privacy.protect(original);
    const encoded = privacy.protect(JSON.stringify({ summary: original }));
    expect(encoded).not.toContain("Sentinel");
    expect(JSON.parse(privacy.restoreContent(encoded)).summary).toBe(original);
    const restored = JSON.parse(
      privacy.restoreContent(
        "```json\n" +
          JSON.stringify({ opening: alias, [alias]: "fixed" }) +
          "\n```",
      ),
    );
    expect(restored.opening).toBe(original);
    expect(restored[alias]).toBe("fixed");
    expect(new AIPrivacyBoundary().restore(alias)).toBe(alias);
  });
  it("does not mask name substrings inside unrelated words or expand private maps recursively", () => {
    const privacy = new AIPrivacyBoundary(["Ali"]);
    const masked = privacy.protect("Ali melakukan validasi.");
    expect(masked).toContain("validasi");
    expect(masked).not.toMatch(/\bAli\b/);
    expect(privacy.protect(masked)).toBe(masked);
    expect(privacy.restore(masked)).toBe("Ali melakukan validasi.");
  });
  it("preserves normal prose containing JSON and safely restores JSON arrays", () => {
    const privacy = new AIPrivacyBoundary(['Ayu "Sentinel"']);
    const alias = privacy.protect('Ayu "Sentinel"');
    expect(
      privacy.restoreContent(
        "Catatan " + alias + ' {"status":"draft"} tetap perlu ditinjau.',
      ),
    ).toBe('Catatan Ayu "Sentinel" {"status":"draft"} tetap perlu ditinjau.');
    expect(
      JSON.parse(privacy.restoreContent(JSON.stringify([{ name: alias }]))),
    ).toEqual([{ name: 'Ayu "Sentinel"' }]);
  });
  it("irreversibly removes credential patterns and retains supported CV contact extraction", () => {
    const value = withoutAISecrets(
      'Nama Ayu, email ayu@example.invalid, sk-1234567890abcdefghijkl api-key="super-secret" Bearer abc.def',
    );
    expect(value).toContain("ayu@example.invalid");
    expect(value).not.toMatch(/1234567890abcdefghijkl|super-secret|abc.def/);
  });
  it("removes labeled credentials from plain, JSON-encoded and nested JSON text", () => {
    for (const raw of [
      'api_key="encoded-secret-sentinel"',
      JSON.stringify({ token: "encoded-secret-sentinel" }),
    ]) {
      for (const text of [
        raw,
        JSON.stringify({ summary: raw }),
        JSON.stringify({ summary: JSON.stringify(raw) }),
      ]) {
        expect(withoutAISecrets(text)).not.toContain("encoded-secret-sentinel");
      }
    }
  });
});
