import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor, requireTransformationAdmin } from "@/lib/transformation/auth";
import { createEngagementSchema } from "@/lib/transformation/schemas";
import { createEngagement, getDb } from "@/lib/transformation/service";
import { z } from "zod";
import { getAccessibleProgramIds, transformationErrorResponse } from "@/lib/transformation/access";
import { jakartaCalendarDate, resolveScheduledProgramStatus, type ProgramStatus } from "@/lib/program-status";

const moduleSelectionSchema = z.array(z.object({
  moduleKey: z.enum(["tbos", "lep", "binainsight"]),
  enabled: z.boolean(),
})).length(3)
  .refine((modules) => new Set(modules.map((module) => module.moduleKey)).size === 3, "Setiap modul program wajib disebut tepat satu kali.")
  .refine((modules) => modules.some((module) => module.enabled), "Pilih minimal satu modul.");

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const organizationId = req.nextUrl.searchParams.get("organization_id");
  const db = getDb();
  let query = db
    .from("engagements")
    .select("*, organization:organizations(id, name), engagement_participants(count)")
    .order("created_at", { ascending: false })
    .limit(100);

  try {
    const programIds = await getAccessibleProgramIds(db, actor);
    if (programIds?.length === 0) return NextResponse.json({ success: true, engagements: [] });
    if (programIds) query = query.in("id", programIds);
    if (actor.role === "admin" && organizationId) query = query.eq("organization_id", organizationId);
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message }, { status: failure.status });
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const today = jakartaCalendarDate();
  let reconciled = data || [];
  try {
    reconciled = await Promise.all((data || []).map(async (row) => {
      const nextStatus = resolveScheduledProgramStatus({
        status: row.status as ProgramStatus,
        startDate: row.start_date,
        endDate: row.end_date,
      }, today);
      if (nextStatus === row.status) return row;
      const updatedAt = new Date().toISOString();
      const { error: updateError } = await db
        .from("engagements")
        .update({ status: nextStatus, updated_at: updatedAt })
        .eq("id", row.id)
        .eq("status", row.status);
      if (updateError) throw updateError;
      return { ...row, status: nextStatus, updated_at: updatedAt };
    }));
  } catch (statusError) {
    return NextResponse.json({
      success: false,
      error: statusError instanceof Error ? statusError.message : "Status program otomatis tidak dapat diselaraskan.",
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    engagements: reconciled.map(({ engagement_participants: memberships, ...engagement }) => ({
      ...engagement,
      participants: memberships?.[0]?.count || 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = createEngagementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }
  const parsedModules = moduleSelectionSchema.safeParse(body?.modules);
  if (!parsedModules.success) {
    return NextResponse.json({ success: false, error: parsedModules.error.issues[0]?.message || "Pilihan modul tidak valid." }, { status: 400 });
  }
  if (Array.isArray(body?.participants) && body.participants.length > 0) {
    return NextResponse.json({
      success: false,
      error: "Peserta tidak lagi ditambahkan saat membuat program. Bagikan tautan program agar peserta mendaftar mandiri.",
    }, { status: 400 });
  }

  let createdEngagementId: string | null = null;
  try {
    const db = getDb();
    const engagement = await createEngagement(db, actor, parsed.data);
    createdEngagementId = engagement.id;

    const { error: moduleError } = await db.from("program_modules").insert(
      parsedModules.data.map((module) => ({
        program_id: engagement.id,
        module_key: module.moduleKey,
        enabled: module.enabled,
      })),
    );
    if (moduleError) {
      await db.from("engagements").delete().eq("id", engagement.id);
      throw new Error(`Gagal menyimpan modul program: ${moduleError.message}`);
    }

    return NextResponse.json({ success: true, engagement }, { status: 201 });
  } catch (error) {
    if (createdEngagementId) {
      const db = getDb();
      await db.from("engagements").delete().eq("id", createdEngagementId);
    }
    const message = error instanceof Error ? error.message : "Gagal membuat engagement.";
    const duplicateCode = /engagements_code_unique_idx|duplicate key/i.test(message);
    return NextResponse.json(
      { success: false, error: duplicateCode ? "Kode program sudah digunakan. Gunakan kode lain." : message },
      { status: duplicateCode ? 409 : 500 },
    );
  }
}
