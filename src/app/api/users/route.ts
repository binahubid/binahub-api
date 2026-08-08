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
    .select("id, user_id, full_name, email, role, created_at, role_updated_at")
    .order("created_at", { ascending: false });

  if (profileErr) {
    return NextResponse.json({ success: false, error: profileErr.message }, { status: 500 });
  }

  // Fetch auth users using Supabase admin
  let authUsersMap: Record<string, any> = {};
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
    if (authUsers?.users) {
      for (const u of authUsers.users) {
        authUsersMap[u.id] = u;
      }
    }
  } catch (err) {
    console.error("[GET /api/users] Error listing auth users:", err);
  }

  const users = (profiles || []).map((p) => {
    const authUser = p.user_id ? authUsersMap[p.user_id] : (p.id ? authUsersMap[p.id] : null);
    return {
      id: p.id || p.user_id,
      user_id: p.user_id || p.id,
      email: p.email || authUser?.email || "Tidak ada email",
      full_name: p.full_name || authUser?.user_metadata?.full_name || "",
      role: p.role || authUser?.app_metadata?.role || "peserta",
      created_at: p.created_at || authUser?.created_at || new Date().toISOString(),
      last_sign_in_at: authUser?.last_sign_in_at || null,
    };
  });

  return NextResponse.json({ success: true, users });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { email, role } = body;
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
      data: { role: targetRole },
    });

    if (inviteErr) {
      return NextResponse.json({ success: false, error: inviteErr.message }, { status: 400 });
    }

    // Upsert to profiles
    if (inviteData.user) {
      const db = createServerSupabase();
      await db.from("profiles").upsert({
        id: inviteData.user.id,
        user_id: inviteData.user.id,
        email,
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
    .or(`id.eq.${id},user_id.eq.${id}`);

  if (updateError) {
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
    await db.from("profiles").delete().or(`id.eq.${id},user_id.eq.${id}`);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Gagal menghapus pengguna." }, { status: 500 });
  }
}
