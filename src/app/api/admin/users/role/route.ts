import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["peserta", "facilitator", "admin", "client"]),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { userId, role } = parsed.data;
  const db = createServerSupabase();

  const { error: updateError } = await db
    .from("profiles")
    .update({
      role,
      role_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  // Force logout: invalidate all sessions for this user
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabaseAdmin.auth.admin.signOut(userId, "global");
  } catch (err) {
    console.error("[API] Force logout failed:", err);
  }

  return NextResponse.json({ success: true, role });
}
