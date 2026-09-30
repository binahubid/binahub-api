import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEngagement, getDb } from "@/lib/transformation/service";
import { createEngagementSchema } from "@/lib/transformation/schemas";
import {
  amsProgramCatalogRequestSchema,
  listAmsAssignablePrograms,
  verifyAmsSignature,
} from "@/lib/ams-integration";

const createProjectSchema = z.object({
  action: z.literal("create"),
  requestId: z.string().uuid(),
  requesterEmail: z.string().email().max(320),
  title: z.string().trim().min(1).max(200),
  clientName: z.string().trim().min(2).max(160),
  moduleKey: z.enum(["tbos", "lep"]),
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
});

const enableModuleSchema = z.object({
  action: z.literal("enable_module"),
  requesterEmail: z.string().email().max(320),
  projectId: z.string().uuid(),
  moduleKey: z.enum(["tbos", "lep"]),
});

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = verifyAmsSignature(
    rawBody,
    request.headers.get("x-binahub-timestamp"),
    request.headers.get("x-binahub-signature"),
  );
  if (!verification.ok) {
    return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid." }, { status: 400 });
  }
  if (typeof value === "object" && value !== null && "action" in value && value.action === "create") {
    const creation = createProjectSchema.safeParse(value);
    if (!creation.success) return NextResponse.json({ success: false, error: "Data project baru tidak valid." }, { status: 400 });
    const input = creation.data;
    const code = `AMS-${input.requestId.replace(/-/g, "").toUpperCase()}`;
    const db = getDb();
    const { data: existing } = await db.from("engagements").select("id, title, organization:organizations(name)").eq("code", code).maybeSingle();
    if (existing) {
      const organization = Array.isArray(existing.organization) ? existing.organization[0] : existing.organization;
      if (existing.title !== input.title || organization?.name !== input.clientName) return NextResponse.json({ success: false, error: "ID permintaan project telah dipakai untuk data lain." }, { status: 409 });
      return NextResponse.json({ success: true, data: { id: existing.id }, duplicate: true });
    }
    let engagementId: string | null = null;
    try {
      const actor = await listAmsAssignablePrograms(input.requesterEmail);
      const payload = createEngagementSchema.parse({
        organizationName: input.clientName,
        code,
        title: input.title,
        type: "training",
        status: "active",
        startDate: input.startDate || undefined,
        endDate: input.endDate || undefined,
      });
      const engagement = await createEngagement(db, { role: "admin", userId: actor.actorProfileId, email: input.requesterEmail }, payload);
      engagementId = engagement.id;
      const { error } = await db.from("program_modules").insert({ program_id: engagement.id, module_key: input.moduleKey, enabled: true });
      if (error) throw error;
      return NextResponse.json({ success: true, data: { id: engagement.id } }, { status: 201 });
    } catch (error) {
      if (engagementId) await db.from("engagements").delete().eq("id", engagementId);
      console.error("[AMS project create] failed", error);
      return NextResponse.json({ success: false, error: "Project APP belum dapat dibuat. Periksa data dan coba lagi." }, { status: 500 });
    }
  }
  if (typeof value === "object" && value !== null && "action" in value && value.action === "enable_module") {
    const parsedModule = enableModuleSchema.safeParse(value);
    if (!parsedModule.success) return NextResponse.json({ success: false, error: "Data modul project tidak valid." }, { status: 400 });
    const input = parsedModule.data;
    try {
      await listAmsAssignablePrograms(input.requesterEmail);
      const db = getDb();
      const { data: project, error: projectError } = await db.from("engagements")
        .select("id, status").eq("id", input.projectId).maybeSingle();
      if (projectError || !project || !["active", "in_progress"].includes(project.status)) {
        return NextResponse.json({ success: false, error: "Project aktif tidak ditemukan." }, { status: 404 });
      }
      const { error } = await db.from("program_modules").upsert({
        program_id: input.projectId,
        module_key: input.moduleKey,
        enabled: true,
      }, { onConflict: "program_id,module_key" });
      if (error) throw error;
      return NextResponse.json({ success: true, data: { id: input.projectId, moduleKey: input.moduleKey } });
    } catch (error) {
      console.error("[AMS project module] failed", error);
      return NextResponse.json({ success: false, error: "Modul project belum dapat diaktifkan." }, { status: 500 });
    }
  }
  const parsed = amsProgramCatalogRequestSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Permintaan katalog program tidak valid." }, { status: 400 });
  }

  try {
    const data = await listAmsAssignablePrograms(parsed.data.requesterEmail);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[AMS program catalog] failed", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Katalog program APP belum dapat dibaca.",
    }, { status: 500 });
  }
}
