import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { getUserFromBearer } from "@/lib/auth-role";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId) {
    return NextResponse.json({ success: false, error: "programId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("lep_speakers")
    .select("id, program_id, name, sort_order")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, speakers: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const { programId, name } = body as { programId?: string; name?: string };

  if (!programId || !name || !name.trim()) {
    return NextResponse.json({ success: false, error: "programId dan name wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();

  // Determine next sort_order
  const { data: existing } = await db
    .from("lep_speakers")
    .select("sort_order")
    .eq("program_id", programId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing && existing[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;

  const { data, error } = await db
    .from("lep_speakers")
    .insert({ program_id: programId, name: name.trim(), sort_order: nextOrder })
    .select("id, program_id, name, sort_order")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, speaker: data });
}
