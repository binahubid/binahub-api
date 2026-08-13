import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const createBatchSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(1).max(50),
});

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId) {
    return NextResponse.json({ success: false, error: "programId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("batches")
    .select("id, program_id, name, sort_order, created_at")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, batches: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const parsed = createBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const db = createServerSupabase();
  const { programId, name } = parsed.data;

  const { count } = await db
    .from("batches")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);

  const { data, error } = await db
    .from("batches")
    .insert({
      program_id: programId,
      name: name.trim(),
      sort_order: (count || 0) + 1,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { success: false, error: `Batch "${name.trim()}" sudah ada untuk program ini.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, batch: data });
}
