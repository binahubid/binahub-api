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

  const { data: profile } = await db
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .single();

  if (profile) {
    role = (profile as any).role || null;
    fullName = (profile as any).full_name || "";
  }

  // 2. Fallback: check app_metadata / user_metadata
  if (!role || role === "peserta" || role === "client") {
    const metadataRole = getUserRole(auth.user);
    if (metadataRole) {
      // Use metadata role if it's more specific than profiles default
      if (!role || role === "peserta") {
        role = metadataRole;
      }
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

  // Sync role back to profiles if it was different
  if (profile && (profile as any).role !== role) {
    await db.from("profiles").update({ role }).eq("id", userId);
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
      app_metadata: { role, provider: "email", providers: ["email"] },
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
