import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { callAms, createAssignmentRequestId } from "@/lib/ams-client";
import { createServerSupabase } from "@/lib/supabase";

const schema = z.object({
  programId: z.string().uuid(),
  moduleKey: z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),
  role: z.string().trim().min(1).max(100),
  associateIds: z.array(z.string().uuid()).min(1).max(100),
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
  const appUrl = (process.env.APP_PUBLIC_URL || "https://app.binahub.id").replace(/\/$/, "");

  try {
    const result = await callAms<{ success: true; data: unknown }>("/api/integrations/app/assignments", {
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
      startDate: program.start_date,
      endDate: program.end_date,
      scope: { ...parsed.data.scope, assignedByProfileId: auth.userId },
      description: `Penugasan ${parsed.data.role} untuk program ${program.title}.`,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (integrationError) {
    console.error("[AMS assignment create] failed", integrationError);
    return NextResponse.json({ success: false, error: integrationError instanceof Error ? integrationError.message : "Penugasan AMS gagal dibuat." }, { status: 503 });
  }
}
