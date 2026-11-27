import { createElement } from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true,
  admin: false,
  download: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-role", () => ({
  getUserFromBearer: async () => state.signedIn
    ? { user: { id: "synthetic-consultant", user_metadata: {} } }
    : { error: "Unauthorized", status: 401 },
  getAuthoritativeUserRole: async () => state.admin ? "admin" : "consultant",
}));
vi.mock("./membership", () => ({
  assertActiveConsultantMembership: async () => undefined,
  ConsultantMembershipError: class extends Error {},
}));
vi.mock("@/lib/supabase", () => ({
  createServerSupabase: () => ({
    rpc: async () => ({ data: state.admin }),
    storage: { from: () => ({ download: state.download }) },
  }),
}));

import { GET } from "@/app/api/konsultan/materials/[slug]/route";

beforeEach(() => {
  state.signedIn = true;
  state.admin = false;
  state.download.mockReset();
});

function read(slug: string, view = "") {
  return GET(new NextRequest(`https://fixture.invalid/api/konsultan/materials/${slug}${view}`), {
    params: Promise.resolve({ slug }),
  });
}

it("keeps the source file off the consultant route and checks login before reading", async () => {
  const forbidden = await read("product-knowledge");
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: "CONSULTANT_MATERIAL_READ_ONLY" });

  state.signedIn = false;
  expect((await read("product-knowledge", "?view=reader")).status).toBe(401);
  expect(state.download).not.toHaveBeenCalled();
});

it("serves the private reader as structured text and keeps the company PDF downloadable", async () => {
  const pdf = await renderToBuffer(createElement(Document, null,
    createElement(Page, { size: "A4", style: { padding: 40 }, bookmark: "Indeks program" },
      createElement(Text, { style: { fontSize: 18 } }, "Indeks program"),
      createElement(Text, { style: { fontSize: 10 } }, "Program kolaborasi SS-01"),
    ),
  ));
  state.download.mockResolvedValue({ data: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }) });

  const response = await read("product-knowledge", "?view=reader");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ pages: [{
    page: 1, title: "Indeks program", blocks: [
      { kind: "heading", text: "Indeks program" },
      { kind: "paragraph", text: "Program kolaborasi SS-01" },
    ],
  }] });

  const company = await read("company-profile");
  expect(company.status).toBe(200);
  expect(company.headers.get("Content-Type")).toBe("application/pdf");
  expect(company.headers.get("Content-Disposition")).toContain("attachment");
});
