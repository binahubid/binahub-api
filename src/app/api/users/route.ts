import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";

const roleSchema = z.enum(["peserta", "facilitator", "admin", "client"]);
const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: roleSchema.default("peserta"),
  full_name: z.string().trim().min(1).max(200).optional(),
});
const updateRoleSchema = z.object({ id: z.string().uuid(), role: roleSchema });

interface ProfileRow {
  id: string;
  full_name: string;
  role: string;
  created_at: string;
  role_updated_at: string | null;
}

interface UnifiedUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

async function listAllAuthUsers(db: ReturnType<typeof createServerSupabase>) {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error("Jumlah akun melebihi batas aman API admin.");
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  // Fetch profiles
  const { data: profiles, error: profileErr } = await db
    .from("profiles")
    .select("id, full_name, role, created_at, role_updated_at")
    .order("created_at", { ascending: false });

  if (profileErr) {
    console.error("[GET /api/users] profiles error:", profileErr);
    return NextResponse.json({ success: false, error: profileErr.message }, { status: 500 });
  }

  // Fetch auth users using Supabase admin
  const authUsersMap: Record<string, User> = {};
  let allAuthUsers: User[] = [];
  try {
    allAuthUsers = await listAllAuthUsers(db);
    for (const user of allAuthUsers) authUsersMap[user.id] = user;
  } catch (err) {
    console.error("[GET /api/users] Error listing auth users:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat akun autentikasi." }, { status: 500 });
  }

  // Build unified user list
  const profileMap: Record<string, ProfileRow> = {};
  for (const p of (profiles || []) as ProfileRow[]) {
    profileMap[p.id] = p;
  }

  // Combine auth users with profiles
  const seenIds = new Set<string>();
  const users: UnifiedUser[] = [];

  // First, add all auth users
  for (const authUser of allAuthUsers) {
    seenIds.add(authUser.id);
    const p = profileMap[authUser.id];
    users.push({
      id: authUser.id,
      email: authUser.email || "Tidak ada email",
      full_name: p?.full_name || authUser.user_metadata?.full_name || authUser.email?.split("@")[0] || "",
      role: p?.role || authUser.app_metadata?.role || "peserta",
      created_at: p?.created_at || authUser.created_at || new Date().toISOString(),
      last_sign_in_at: authUser.last_sign_in_at || null,
    });
  }

  // Then add any profiles not in auth users list (if any)
  for (const p of (profiles || []) as ProfileRow[]) {
    if (!seenIds.has(p.id)) {
      const authUser = authUsersMap[p.id];
      users.push({
        id: p.id,
        email: authUser?.email || "Tidak ada email",
        full_name: p.full_name || "",
        role: p.role || "peserta",
        created_at: p.created_at || new Date().toISOString(),
        last_sign_in_at: authUser?.last_sign_in_at || null,
      });
    }
  }

  return NextResponse.json({ success: true, users });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Data undangan tidak valid." }, { status: 400 });
  const { email, role: targetRole, full_name } = parsed.data;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Invite user via Supabase Auth
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name || email.split("@")[0] },
    });

    if (inviteErr) {
      return NextResponse.json({ success: false, error: inviteErr.message }, { status: 400 });
    }

    // Upsert to profiles
    if (inviteData.user) {
      const db = createServerSupabase();
      const { error: profileError } = await db.from("profiles").upsert({
        id: inviteData.user.id,
        full_name: full_name || email.split("@")[0],
        role: targetRole,
        role_updated_at: new Date().toISOString(),
      });
      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(inviteData.user.id);
        return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
      }
      const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(inviteData.user.id, {
        app_metadata: { role: targetRole },
      });
      if (metadataError) {
        await supabaseAdmin.auth.admin.deleteUser(inviteData.user.id);
        return NextResponse.json({ success: false, error: metadataError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, user: inviteData.user });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal mengundang user." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = updateRoleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "ID atau role tidak valid." }, { status: 400 });
  const { id, role } = parsed.data;
  if (id === auth.userId && role !== "admin") {
    return NextResponse.json({ success: false, error: "Admin tidak dapat menurunkan role akunnya sendiri." }, { status: 409 });
  }

  const db = createServerSupabase();

  // Update profile
  const { data: updatedProfile, error: updateError } = await db
    .from("profiles")
    .update({
      role,
      role_updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[PATCH /api/users] Update profile error:", updateError);
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }
  if (!updatedProfile) return NextResponse.json({ success: false, error: "Pengguna tidak ditemukan." }, { status: 404 });

  // Update auth metadata & force logout
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: targetUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(id);
    if (userError || !targetUser.user) {
      return NextResponse.json({ success: false, error: "Akun autentikasi tidak ditemukan." }, { status: 404 });
    }
    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      app_metadata: { ...targetUser.user.app_metadata, role },
    });
    if (metadataError) {
      return NextResponse.json({ success: false, error: `Role tersimpan tetapi metadata auth gagal disinkronkan: ${metadataError.message}` }, { status: 500 });
    }

    const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(id, "global");
    if (signOutError) {
      return NextResponse.json({ success: false, error: `Role tersimpan tetapi sesi lama gagal dicabut: ${signOutError.message}` }, { status: 500 });
    }
  } catch (err) {
    console.error("[PATCH /api/users] Auth sync error:", err);
  }

  return NextResponse.json({ success: true, role });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "ID pengguna diperlukan." }, { status: 400 });
  }
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ success: false, error: "ID pengguna tidak valid." }, { status: 400 });
  }
  if (id === auth.userId) {
    return NextResponse.json({ success: false, error: "Admin tidak dapat menghapus akunnya sendiri." }, { status: 409 });
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabaseAdmin.auth.admin.deleteUser(id);

    const db = createServerSupabase();
    await db.from("profiles").delete().eq("id", id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Gagal menghapus pengguna." }, { status: 500 });
  }
}
