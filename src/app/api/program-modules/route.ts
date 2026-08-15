import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTransformationAdmin } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";

const MODULE_KEYS = ["tbos", "lep"] as const;

const moduleItemSchema = z.object({
  moduleKey: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
});

const putSchema = z.object({
  programId: z.string().uuid(),
  modules: z.array(moduleItemSchema).min(1).max(MODULE_KEYS.length)
    .refine((modules) => new Set(modules.map((module) => module.moduleKey)).size === modules.length, "Module key tidak boleh duplikat."),
});

export async function GET(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (programId && !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }
  const db = getDb();
  let query = db.from("program_modules").select("program_id, module_key, enabled");
  if (programId) {
    query = query.eq("program_id", programId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, modules: data || [] });
}

export async function PUT(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
  }

  const { programId, modules } = parsed.data;
  const db = getDb();

  const { data: program } = await db.from("engagements").select("id").eq("id", programId).maybeSingle();
  if (!program) {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }

  const rows = modules.map((m) => ({
    program_id: programId,
    module_key: m.moduleKey,
    enabled: m.enabled,
  }));

  const { error } = await db.from("program_modules").upsert(rows, { onConflict: "program_id,module_key" });
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, modules: rows });
}
