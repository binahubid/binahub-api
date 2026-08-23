import { NextRequest, NextResponse } from "next/server";
import { requireTransformationAdmin } from "@/lib/transformation/auth";
import { engagementTypeSchema, engagementStatusSchema } from "@/lib/transformation/schemas";
import { getDb } from "@/lib/transformation/service";
import { z } from "zod";

const updateSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  type: engagementTypeSchema.optional(),
  status: engagementStatusSchema.optional(),
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  location: z.string().trim().min(1).max(200).nullable().optional(),
  participantLimit: z.number().int().min(1).max(5000).optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
  const db = getDb();
  const { data: existing, error: existingError } = await db.from("engagements").select("start_date, end_date").eq("id", id).maybeSingle();
  if (existingError) return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  if (parsed.data.participantLimit !== undefined) {
    const { count, error: countError } = await db
      .from("engagement_participants")
      .select("participant_id", { count: "exact", head: true })
      .eq("engagement_id", id);
    if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
    if ((count || 0) > parsed.data.participantLimit) {
      return NextResponse.json({ success: false, error: `Kapasitas tidak boleh lebih kecil dari ${count || 0} peserta yang sudah terdaftar.` }, { status: 409 });
    }
  }
  const nextStart = parsed.data.startDate === undefined ? existing.start_date : parsed.data.startDate;
  const nextEnd = parsed.data.endDate === undefined ? existing.end_date : parsed.data.endDate;
  if (nextStart && nextEnd && nextStart > nextEnd) {
    return NextResponse.json({ success: false, error: "Tanggal selesai tidak boleh sebelum tanggal mulai." }, { status: 400 });
  }
  const { data, error } = await db.from("engagements").update({
    ...(parsed.data.code === undefined ? {} : { code: parsed.data.code.toUpperCase() }),
    ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
    ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.startDate === undefined ? {} : { start_date: parsed.data.startDate }),
    ...(parsed.data.endDate === undefined ? {} : { end_date: parsed.data.endDate }),
    ...(parsed.data.location === undefined ? {} : { location: parsed.data.location }),
    ...(parsed.data.participantLimit === undefined ? {} : { participant_limit: parsed.data.participantLimit }),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select().single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, engagement: data });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  const { id } = await context.params;
  const db = getDb();
  const { data: teamRows, error: teamsError } = await db.from("tbos_teams").select("id").eq("engagement_id", id);
  if (teamsError) return NextResponse.json({ success: false, error: teamsError.message }, { status: 500 });
  const teamIds = (teamRows || []).map((team) => team.id);
  const { count, error: countError } = await db
    .from("tbos_observations")
    .select("id", { count: "exact", head: true })
    .eq("program_id", id);
  if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  if ((count || 0) > 0) return NextResponse.json({ success: false, error: "Program memiliki histori observasi dan hanya dapat diarsipkan.", code: "PROGRAM_HAS_OBSERVATIONS", canArchive: true }, { status: 409 });
  const { count: lepCount, error: lepCountError } = await db
    .from("lep_responses")
    .select("id", { count: "exact", head: true })
    .eq("program_id", id);
  if (lepCountError) return NextResponse.json({ success: false, error: lepCountError.message }, { status: 500 });
  if ((lepCount || 0) > 0) return NextResponse.json({ success: false, error: "Program memiliki respons LEP dan hanya dapat diarsipkan.", code: "PROGRAM_HAS_LEP_RESPONSES", canArchive: true }, { status: 409 });
  const { count: assessmentCount, error: assessmentCountError } = await db
    .from("assessments")
    .select("id", { count: "exact", head: true })
    .eq("program_id", id);
  if (assessmentCountError) return NextResponse.json({ success: false, error: assessmentCountError.message }, { status: 500 });
  if ((assessmentCount || 0) > 0) return NextResponse.json({ success: false, error: "Program memiliki hasil BinaInsight dan hanya dapat diarsipkan.", code: "PROGRAM_HAS_BINAINSIGHT_RESULTS", canArchive: true }, { status: 409 });
  if (teamIds.length > 0) {
    const { error: deleteTeamsError } = await db.from("tbos_teams").delete().eq("engagement_id", id);
    if (deleteTeamsError) {
      return NextResponse.json({
        success: false,
        error: "Tim program masih memiliki data terkait dan tidak dapat dihapus. Arsipkan program agar histori tetap aman.",
        detail: deleteTeamsError.message,
        code: "PROGRAM_TEAMS_HAVE_RELATED_DATA",
        canArchive: true,
      }, { status: 409 });
    }
  }
  const { error } = await db.from("engagements").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return NextResponse.json({
        success: false,
        error: "Program masih memiliki data terkait dan tidak dapat dihapus. Arsipkan program untuk mempertahankan histori.",
        code: "PROGRAM_HAS_RELATED_DATA",
        canArchive: true,
      }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
