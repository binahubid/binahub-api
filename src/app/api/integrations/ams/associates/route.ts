import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { callAms } from "@/lib/ams-client";

const querySchema = z.object({
  query: z.string().trim().max(200).default(""),
  role: z.string().trim().max(100).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const parsed = querySchema.safeParse({
    query: req.nextUrl.searchParams.get("query") || "",
    role: req.nextUrl.searchParams.get("role") || undefined,
  });
  if (!parsed.success) return NextResponse.json({ success: false, error: "Pencarian associate tidak valid." }, { status: 400 });

  try {
    const result = await callAms<{ success: true; data: unknown[] }>("/api/integrations/app/associates/search", {
      ...parsed.data,
      limit: 50,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[AMS associate search] failed", error);
    return NextResponse.json({ success: false, error: "Daftar associate AMS belum dapat dimuat." }, { status: 503 });
  }
}
