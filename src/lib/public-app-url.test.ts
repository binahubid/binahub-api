import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicAppUrl } from "@/lib/public-app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public APP URL", () => {
  it("memakai domain production ketika konfigurasi kosong", () => {
    expect(resolvePublicAppUrl("")).toBe("https://app.binahub.id");
  });

  it("menolak host lokal pada production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolvePublicAppUrl("https://0.0.0.0:3000")).toBe("https://app.binahub.id");
    expect(resolvePublicAppUrl("http://localhost:3000")).toBe("https://app.binahub.id");
  });

  it("menerima origin HTTPS production yang valid", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolvePublicAppUrl("https://app.binahub.id/salah/path")).toBe("https://app.binahub.id");
  });
});
