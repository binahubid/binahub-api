import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { z } from "zod";

const idSchema = z.string().uuid();
const updateSpeakerSchema = z.object({ name: z.string().trim().min(1).max(200) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ success: false, error: "ID pemateri tidak valid." }, { status: 400 });
  const parsed = updateSpeakerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Nama pemateri tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  const { data, error } = await db
    .from("lep_speakers")
    .update({ name: parsed.data.name })
    .eq("id", id)
    .select("id, program_id, name, sort_order")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.code === "23505" ? 409 : 500 });
  }

  return NextResponse.json({ success: true, speaker: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ success: false, error: "ID pemateri tidak valid." }, { status: 400 });
  const db = createServerSupabase();

  const { error } = await db
    .from("lep_speakers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
