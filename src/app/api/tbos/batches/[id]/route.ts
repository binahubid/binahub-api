import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const db = createServerSupabase();
  const { data: batch, error: batchError } = await db.from("batches").select("program_id").eq("id", id).maybeSingle();
  if (batchError) return NextResponse.json({ success: false, error: batchError.message }, { status: 500 });
  if (!batch) return NextResponse.json({ success: false, error: "Batch tidak ditemukan." }, { status: 404 });
  if (!(await isProgramModuleEnabled(db, batch.program_id, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }

  const { count, error: countError } = await db
    .from("tbos_teams")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", id);

  if (countError) {
    return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  }

  if ((count || 0) > 0) {
    return NextResponse.json(
      { success: false, error: "Batch masih digunakan oleh tim. Hapus atau pindahkan tim terlebih dahulu." },
      { status: 409 }
    );
  }

  const { error } = await db.from("batches").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
