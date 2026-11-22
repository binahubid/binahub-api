import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: () => ({ storage: { from: (bucket: string) => {
  expect(bucket).toBe("consultant-materials"); return { createSignedUrl: storage.sign };
} } }) }));
import { POST } from "@/app/api/integrations/ams/materials/route";
const secret = "synthetic-materials-integration-only";
const payload = { purpose: "ams-admin-materials", requesterId: "11111111-1111-4111-8111-111111111111", action: "catalog" };
afterEach(() => { vi.unstubAllEnvs(); storage.sign.mockClear(); });

function request(body: unknown, signed = true) {
  vi.stubEnv("AMS_INTEGRATION_SECRET", secret);
  const raw = JSON.stringify(body), timestamp = String(Date.now());
  return new NextRequest("https://api.example.invalid/api/integrations/ams/materials", { method: "POST", body: raw,
    headers: signed ? { "x-binahub-timestamp": timestamp, "x-binahub-signature": createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex") } : {},
  });
}

it("requires the signed admin-materials scope and does not accept an unrelated integration payload", async () => {
  expect((await POST(request(payload, false))).status).toBe(401);
  expect((await POST(request({ ...payload, purpose: "another-integration" }))).status).toBe(400);
  expect(storage.sign).not.toHaveBeenCalled();
});

it("returns the approved documents and all 66 video versions in the existing episode catalog", async () => {
  const response = await POST(request(payload));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const { data } = await response.json();
  expect(data.documents.map(({ slug, filename }: { slug: string; filename: string }) => [slug, filename])).toEqual([
    ["company-profile", "BinaHub-company-profile-v3.pdf"],
    ["product-knowledge", "BinaHub-product-knowledge-v3.pdf"],
  ]);
  expect(data.videos).toHaveLength(29);
  expect(data.videos.filter((video: { versions: { en?: unknown } }) => video.versions.en)).toHaveLength(29);
  const mobile = data.videos.filter((video: { versions: { mobile?: unknown } }) => video.versions.mobile);
  expect(mobile.map((video: { id: string }) => video.id)).toEqual(
    Array.from({ length: 8 }, (_, index) => "S0" + (index + 1)),
  );
  const fileIds = data.videos.flatMap((video: {
    drive: { fileId: string };
    versions: Record<string, { drive: { fileId: string } }>;
  }) => [video.drive.fileId, ...Object.values(video.versions).map(({ drive }) => drive.fileId)]);
  expect(new Set(fileIds).size).toBe(66);
  expect(data.documents.every((document: Record<string, unknown>) => !document.url && !document.storageName)).toBe(true);
  expect(storage.sign).not.toHaveBeenCalled();
});

it("only signs a known document for two minutes, never an arbitrary storage path", async () => {
  for (const slug of ["company-profile-v1", "product-knowledge-v1", "../private-file"]) {
    const rejected = await POST(request({ ...payload, action: "document", slug }));
    expect(rejected.status).toBe(404);
  }
  expect(storage.sign).not.toHaveBeenCalled();
  storage.sign.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/consultant-materials/approved.pdf?token=synthetic" }, error: null });
  const response = await POST(request({ ...payload, action: "document", slug: "product-knowledge" }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.expiresInSeconds).toBe(120);
  expect(storage.sign).toHaveBeenCalledWith("product-knowledge-binahub-v3.pdf", 120);
});
