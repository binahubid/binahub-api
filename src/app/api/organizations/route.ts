import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";

const schema = z.object({ name: z.string().trim().min(2).max(160) });

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Akses admin diperlukan." }, { status: 403 });
  }
  const { data, error } = await getDb().from("organizations").select("id, name").order("name").limit(200);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, organizations: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Akses admin diperlukan." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Nama perusahaan tidak valid." }, { status: 400 });
  const db = getDb();
  const existing = await db.from("organizations").select("id, name").ilike("name", parsed.data.name).maybeSingle();
  if (existing.data) return NextResponse.json({ success: true, organization: existing.data });
  const { data, error } = await db.from("organizations").insert({ name: parsed.data.name }).select("id, name").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, organization: data }, { status: 201 });
}
