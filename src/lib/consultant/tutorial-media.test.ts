import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ status: 200 }));
vi.mock("@/lib/consultant/http", () => {
  class ConsultantError extends Error {
    constructor(_code: string, readonly status: number) { super("media test"); }
  }
  return {
    ConsultantError, consultantHeaders: { "Cache-Control": "private, no-store" },
    consultantFailure: (error: ConsultantError) => new Response(null, { status: error.status }),
    requireConsultant: (request: NextRequest) => {
      if (!request.headers.has("Authorization")) throw new ConsultantError("SIGN_IN", 401);
      if (auth.status !== 200) throw new ConsultantError("MEMBERSHIP", auth.status);
    },
  };
});
import { GET, HEAD } from "@/app/api/konsultan/materials/media/[id]/route";

const episode = vi.hoisted(() => ({
  id: "F01",
  drive: { fileId: "public-file-0000000000001" },
  versions: {
    en: { drive: { fileId: "english-file-000000000001", resourceKey: "sample-resource-key" } },
  },
}));
vi.mock("@/lib/consultant/materials", () => ({ consultantTutorials: [episode] }));
const context = { params: Promise.resolve({ id: "F01" }) };
afterEach(() => vi.unstubAllGlobals());

function provider({ membership = 200, type = "video/mp4", size = 12_000_000 } = {}) {
  auth.status = membership;
  const transfers: { url: string; range: string | null; authorization: string | null }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    transfers.push({ url: url.href, range: headers.get("Range"), authorization: headers.get("Authorization") });
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("Range") || "bytes=0-15")!;
    const start = Number(range[1]), end = Math.min(Number(range[2]), size - 1);
    const bytes = new Uint8Array(end - start + 1);
    return new Response(bytes, { status: 206, headers: { "Content-Type": type, "Content-Length": String(bytes.length), "Content-Range": `bytes ${start}-${end}/${size}` } });
  });
  return transfers;
}

it("denies missing and inactive sessions before requesting any video bytes", async () => {
  let transfers = provider();
  expect((await GET(new NextRequest("https://app.example.invalid/media"), context)).status).toBe(401);
  expect(transfers).toHaveLength(0);
  transfers = provider({ membership: 403 });
  expect((await GET(new NextRequest("https://app.example.invalid/media", { headers: { Authorization: "Bearer synthetic" } }), context)).status).toBe(403);
  expect(transfers).toHaveLength(0);
});

it("streams a bounded byte range from the allowlisted file, without forwarding the user's token", async () => {
  const transfers = provider();
  const response = await GET(new NextRequest("https://app.example.invalid/media?url=https://untrusted.invalid", {
    headers: { Authorization: "Bearer synthetic", Range: "bytes=0-9999999" },
  }), context);
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 0-2097151/12000000");
  expect((await response.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(transfers).toHaveLength(1);
  expect(new URL(transfers[0].url).origin).toBe("https://drive.usercontent.google.com");
  expect(new URL(transfers[0].url).searchParams.get("id")).toBe(episode.drive.fileId);
  expect(transfers[0].authorization).toBeNull();
});

it("rejects invalid ranges and unknown episodes before reaching the provider", async () => {
  const transfers = provider();
  const request = (range: string) => new NextRequest("https://app.example.invalid/media", { headers: { Authorization: "Bearer synthetic", Range: range } });
  for (const range of ["bytes=0-1,10-12", "bytes=9-2", "bytes=-", "bytes=9007199254740993-"]) {
    expect((await GET(request(range), context)).status).toBe(416);
  }
  expect((await GET(request("bytes=0-1"), { params: Promise.resolve({ id: "UNKNOWN" }) })).status).toBe(404);
  expect(transfers).toHaveLength(0);
});

it("selects the requested Drive version and refuses unavailable or invalid choices", async () => {
  const transfers = provider();
  const base = "https://app.example.invalid/media";
  const headers = { Authorization: "Bearer synthetic", Range: "bytes=0-15" };
  expect((await GET(new NextRequest(base + "?version=mobile", { headers }), context)).status).toBe(404);
  expect((await GET(new NextRequest(base + "?version=unknown", { headers }), context)).status).toBe(404);
  expect(transfers).toHaveLength(0);
  const response = await GET(new NextRequest(base + "?version=en", { headers }), context);
  expect(response.status).toBe(206);
  const upstream = new URL(transfers[0].url);
  expect(upstream.searchParams.get("id")).toBe(episode.versions.en.drive.fileId);
  expect(upstream.searchParams.get("resourcekey")).toBe(episode.versions.en.drive.resourceKey);
});

it("supports metadata HEAD and refuses HTML or oversized responses as video", async () => {
  provider();
  const request = new NextRequest("https://app.example.invalid/media", { method: "HEAD", headers: { Authorization: "Bearer synthetic" } });
  const head = await HEAD(request, context);
  expect(head.status).toBe(200);
  expect(head.headers.get("Content-Length")).toBe("12000000");
  expect(await head.text()).toBe("");
  for (const options of [{ type: "text/html" }, { size: 60_000_000 }]) {
    provider(options);
    expect((await GET(new NextRequest(request.url, { headers: { Authorization: "Bearer synthetic", Range: "bytes=0-15" } }), context)).status).toBe(503);
  }
});
