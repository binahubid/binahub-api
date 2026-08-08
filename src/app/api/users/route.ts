import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

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
  let authUsersMap: Record<string, any> = {};
  let allAuthUsers: any[] = [];
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: authUsers, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (authUsers?.users) {
      allAuthUsers = authUsers.users;
      for (const u of authUsers.users) {
        authUsersMap[u.id] = u;
      }
    }
    if (listErr) {
      console.warn("[GET /api/users] listUsers error:", listErr);
    }
  } catch (err) {
    console.error("[GET /api/users] Error listing auth users:", err);
  }

  // Build unified user list
  const profileMap: Record<string, any> = {};
  for (const p of profiles || []) {
    profileMap[p.id] = p;
  }

  // Combine auth users with profiles
  const seenIds = new Set<string>();
  const users: any[] = [];

  // First, add all auth users
  for (const authUser of allAuthUsers) {
    seenIds.add(authUser.id);
    const p = profileMap[authUser.id];
    users.push({
      id: authUser.id,
      email: authUser.email || "Tidak ada email",
      full_name: p?.full_name || authUser.user_metadata?.full_name || authUser.email?.split("@")[0] || "",
      role: p?.role || authUser.app_metadata?.role || authUser.user_metadata?.role || "peserta",
      created_at: p?.created_at || authUser.created_at || new Date().toISOString(),
      last_sign_in_at: authUser.last_sign_in_at || null,
    });
  }

  // Then add any profiles not in auth users list (if any)
  for (const p of profiles || []) {
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

  const body = await req.json();
  const { email, role, full_name } = body;
  if (!email) {
    return NextResponse.json({ success: false, error: "Email wajib diisi." }, { status: 400 });
  }

  const validRoles = ["peserta", "facilitator", "admin", "client"];
  const targetRole = validRoles.includes(role) ? role : "peserta";

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Invite user via Supabase Auth
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role: targetRole, full_name: full_name || email.split("@")[0] },
    });

    if (inviteErr) {
      return NextResponse.json({ success: false, error: inviteErr.message }, { status: 400 });
    }

    // Upsert to profiles
    if (inviteData.user) {
      const db = createServerSupabase();
      await db.from("profiles").upsert({
        id: inviteData.user.id,
        full_name: full_name || email.split("@")[0],
        role: targetRole,
        role_updated_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true, user: inviteData.user });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Gagal mengundang user." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { id, role } = body;
  if (!id || !role) {
    return NextResponse.json({ success: false, error: "ID dan role wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();

  // Update profile
  const { error: updateError } = await db
    .from("profiles")
    .update({
      role,
      role_updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    console.error("[PATCH /api/users] Update profile error:", updateError);
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  // Update auth metadata & force logout
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabaseAdmin.auth.admin.updateUserById(id, {
      app_metadata: { role },
      user_metadata: { role },
    });

    await supabaseAdmin.auth.admin.signOut(id, "global");
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
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Gagal menghapus pengguna." }, { status: 500 });
  }
}
