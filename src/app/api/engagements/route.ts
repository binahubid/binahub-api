import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor, requireTransformationAdmin } from "@/lib/transformation/auth";
import { createEngagementSchema } from "@/lib/transformation/schemas";
import { createEngagement, createParticipant, generateAccessCodesForEngagement, getDb } from "@/lib/transformation/service";
import { z } from "zod";
import { getAccessibleProgramIds, transformationErrorResponse } from "@/lib/transformation/access";

const moduleSelectionSchema = z.array(z.object({
  moduleKey: z.enum(["tbos", "lep"]),
  enabled: z.boolean(),
})).length(2)
  .refine((modules) => new Set(modules.map((module) => module.moduleKey)).size === 2, "Modul T-BOS dan LEP wajib disebut tepat satu kali.")
  .refine((modules) => modules.some((module) => module.enabled), "Pilih minimal satu modul.");

const participantDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
  role: z.enum(["participant", "leader", "observer"]).optional().default("participant"),
});

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

  return NextResponse.json({
    success: true,
    engagements: (data || []).map(({ engagement_participants: memberships, ...engagement }) => ({
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
  const parsedParticipants = z.array(participantDraftSchema).max(500).safeParse(body?.participants ?? []);
  if (!parsedParticipants.success) {
    return NextResponse.json({ success: false, error: parsedParticipants.error.issues[0]?.message || "Daftar peserta tidak valid." }, { status: 400 });
  }

  let createdEngagementId: string | null = null;
  const createdParticipantIds: string[] = [];
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

    const createdParticipants: Array<{ id: string; name: string }> = [];

    if (parsedParticipants.data.length > 0) {
      for (const p of parsedParticipants.data) {
        const participant = await createParticipant(db, {
          organizationId: engagement.organization_id,
          engagementId: engagement.id,
          name: p.name,
          email: p.email,
          engagementRole: p.role,
        });
        createdParticipantIds.push(participant.id);
        createdParticipants.push({ id: participant.id, name: p.name });
      }
    }

    let accessCodes: Array<{ code: string; companyName: string; teamName: string; participantId: string }> = [];

    if (createdParticipants.length > 0) {
      const { data: org } = await db.from("organizations").select("name").eq("id", engagement.organization_id).single();
      const orgName = org?.name || "Unknown";

      accessCodes = await generateAccessCodesForEngagement(
        db,
        engagement.id,
        engagement.organization_id,
        orgName,
        createdParticipants,
      );
    }

    return NextResponse.json({ success: true, engagement, accessCodes }, { status: 201 });
  } catch (error) {
    if (createdEngagementId) {
      const db = getDb();
      if (createdParticipantIds.length > 0) {
        await db.from("app_client_access_codes").delete().in("participant_id", createdParticipantIds);
        await db.from("participants").delete().in("id", createdParticipantIds);
      }
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
