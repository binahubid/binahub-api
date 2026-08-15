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
  if (userId === auth.userId && role !== "admin") {
    return NextResponse.json({ success: false, error: "Admin tidak dapat menurunkan role akunnya sendiri." }, { status: 409 });
  }
  const db = createServerSupabase();

  const { data: updatedProfile, error: updateError } = await db
    .from("profiles")
    .update({
      role,
      role_updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }
  if (!updatedProfile) return NextResponse.json({ success: false, error: "Pengguna tidak ditemukan." }, { status: 404 });

  // Sync role to app_metadata BEFORE force logout, so new JWT has correct role
  const { data: targetUser, error: userError } = await db.auth.admin.getUserById(userId);
  if (userError || !targetUser.user) {
    return NextResponse.json({ success: false, error: "Akun autentikasi tidak ditemukan." }, { status: 404 });
  }
  const { error: metadataError } = await db.auth.admin.updateUserById(userId, {
    app_metadata: { ...targetUser.user.app_metadata, role },
  });
  if (metadataError) {
    return NextResponse.json({ success: false, error: `Role tersimpan tetapi metadata auth gagal disinkronkan: ${metadataError.message}` }, { status: 500 });
  }

  const { error: signOutError } = await db.auth.admin.signOut(userId, "global");
  if (signOutError) {
    return NextResponse.json({ success: false, error: `Role tersimpan tetapi sesi lama gagal dicabut: ${signOutError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, role });
}
