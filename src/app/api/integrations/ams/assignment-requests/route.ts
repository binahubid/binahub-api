import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { callAms, createAssignmentRequestId } from "@/lib/ams-client";
import { createServerSupabase } from "@/lib/supabase";
import { resolvePublicAppUrl } from "@/lib/public-app-url";

export const maxDuration = 60;

const schema = z.object({
  programId: z.string().uuid(),
  moduleKey: z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),
  role: z.string().trim().min(1).max(100),
  associateIds: z.array(z.string().uuid()).min(1).max(100),
  fee: z.object({
    compensation: z.number().int().finite().positive(),
    transport: z.number().int().finite().min(0).optional(),
    preparation: z.number().int().finite().min(0).optional(),
  }),
  invitationExpiresAt: z.string().datetime({ offset: true }).refine((value) => {
    const remaining = new Date(value).getTime() - Date.now();
    return remaining >= 5 * 60_000 && remaining <= 30 * 24 * 60 * 60_000;
  }),
  scope: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Data penugasan tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  const { data: program, error } = await db
    .from("engagements")
    .select("id, title, start_date, end_date, organization:organizations(name)")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (error || !program) return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  const organization = Array.isArray(program.organization) ? program.organization[0] : program.organization;
  const appUrl = resolvePublicAppUrl();

  const request = {
      requestId: createAssignmentRequestId(),
      program: {
        id: program.id,
        title: program.title,
        clientName: organization?.name || "Klien BinaHub",
        url: `${appUrl}/${parsed.data.moduleKey === "tbos" ? "fasilitator/tbos" : ""}`,
        moduleKey: parsed.data.moduleKey,
      },
      role: parsed.data.role,
      associateIds: parsed.data.associateIds,
      fee: parsed.data.fee,
      invitationExpiresAt: parsed.data.invitationExpiresAt,
      startDate: program.start_date,
      endDate: program.end_date,
      scope: { ...parsed.data.scope, assignedByProfileId: auth.userId },
      description: `Penugasan ${parsed.data.role} untuk project ${program.title}.`,
    };
  try {
    let result: { success: true; data: unknown };
    try {
      result = await callAms<{ success: true; data: unknown }>("/api/integrations/app/assignments", request);
    } catch (firstError) {
      if (!(firstError instanceof Error) || !/abort|timeout/i.test(`${firstError.name} ${firstError.message}`)) throw firstError;
      // AMS may have saved the invitation before the 15-second network timeout.
      // Reuse the SAME requestId so the retry only reads that persisted result.
      result = await callAms<{ success: true; data: unknown }>("/api/integrations/app/assignments", request);
    }
    return NextResponse.json(result, { status: 201 });
  } catch (integrationError) {
    console.error("[AMS assignment create] failed", integrationError);
    const timedOut = integrationError instanceof Error && /abort|timeout/i.test(`${integrationError.name} ${integrationError.message}`);
    return NextResponse.json({ success: false, error: timedOut
      ? "Status undangan belum dapat dipastikan. Periksa daftar penugasan AMS sebelum mengirim ulang agar penawaran tidak ganda."
      : integrationError instanceof Error ? integrationError.message : "Penugasan AMS gagal dibuat." }, { status: 503 });
  }
}
