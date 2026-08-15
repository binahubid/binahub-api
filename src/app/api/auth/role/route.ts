import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { getUserFromBearer, getUserRole, normalizeEmail, isAdminFallbackEmail, isFacilitatorFallbackEmail } from "@/lib/auth-role";

export async function GET(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const userId = auth.user.id;
  const email = normalizeEmail(auth.user.email);

  // 1. Check profiles table for role
  let role: string | null = null;
  let fullName = "";

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { success: false, error: "Gagal memverifikasi role pengguna." },
      { status: 500 },
    );
  }

  if (profile) {
    role = profile.role || null;
    fullName = profile.full_name || "";
    if (!role || !["admin", "facilitator", "client", "peserta"].includes(role)) {
      return NextResponse.json(
        { success: false, error: "Role profil pengguna tidak valid." },
        { status: 500 },
      );
    }
  }

  // 2. Only use trusted app metadata when a profile row does not exist yet.
  if (!profile) {
    const metadataRole = getUserRole(auth.user);
    if (metadataRole) {
      role = metadataRole;
    }
  }

  // 3. Fallback: email allowlist
  if (!role || role === "peserta") {
    if (isAdminFallbackEmail(email)) {
      role = "admin";
    } else if (isFacilitatorFallbackEmail(email)) {
      role = "facilitator";
    }
  }

  if (!role) {
    role = "peserta";
  }

  fullName = fullName
    || String(auth.user.user_metadata?.full_name || auth.user.user_metadata?.company_name || "").trim()
    || email;

  // Create the profile once for bootstrap users. Existing profile roles are never overwritten here.
  if (!profile) {
    const { error: profileSyncError } = await db
      .from("profiles")
      .upsert({ id: userId, role, full_name: fullName });
    if (profileSyncError) {
      return NextResponse.json(
        { success: false, error: "Gagal membuat profil pengguna." },
        { status: 500 },
      );
    }
  }

  // Also sync to app_metadata so Supabase Auth has it
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { ...auth.user.app_metadata, role },
    });
  } catch (err) {
    console.error("[API] Failed to sync role to app_metadata:", err);
  }

  return NextResponse.json({
    success: true,
    role,
    fullName,
    redirectTo: "/home",
  });
}
