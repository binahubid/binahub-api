import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name } = body as { name?: string };

  if (!name || !name.trim()) {
    return NextResponse.json({ success: false, error: "Nama pemateri wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("lep_speakers")
    .update({ name: name.trim() })
    .eq("id", id)
    .select("id, program_id, name, sort_order")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
  const db = createServerSupabase();

  const { error } = await db.from("lep_speakers").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
