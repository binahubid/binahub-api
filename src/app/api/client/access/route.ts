import { NextRequest, NextResponse } from "next/server";
import { hashAccessCode } from "@/lib/client-access";
import { createServerSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createOpaqueToken } from "@/lib/secure-token";
import type { User } from "@supabase/supabase-js";

async function findLegacyUserByEmail(db: ReturnType<typeof createServerSupabase>, email: string): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Batas pencarian akun legacy terlampaui.");
}

export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "client-access", 10, 15 * 60);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").trim();

  if (!code || code.length > 128) {
    return NextResponse.json({ success: false, error: "Kode akses wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id, auth_user_id")
    .eq("code_hash", hashAccessCode(code))
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ success: false, error: "Kode akses tidak valid." }, { status: 401 });
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ success: false, error: "Kode akses sudah kedaluwarsa." }, { status: 401 });
  }

  const clientEmail = `client-${data.id}@binahub.local`;
  const clientPassword = createOpaqueToken();

  let userId: string;
  let existingUser: User | null = null;
  if (data.auth_user_id) {
    const { data: existing, error: existingError } = await db.auth.admin.getUserById(data.auth_user_id);
    if (existingError && existingError.status !== 404) {
      return NextResponse.json({ success: false, error: "Gagal memeriksa akun client." }, { status: 500 });
    }
    existingUser = existing.user;
  } else {
    try {
      existingUser = await findLegacyUserByEmail(db, clientEmail);
    } catch (lookupError) {
      console.error("[Client Access] Legacy account lookup failed:", lookupError);
      return NextResponse.json({ success: false, error: "Gagal memeriksa akun client." }, { status: 500 });
    }
  }

  if (existingUser) {
    userId = existingUser.id;
    const { error: updateUserError } = await db.auth.admin.updateUserById(userId, {
      password: clientPassword,
      app_metadata: { role: "client", access_code_id: data.id, organization_id: data.organization_id, participant_id: data.participant_id },
      user_metadata: {
        company_name: data.company_name,
        team_name: data.team_name,
        access_code_id: data.id,
        organization_id: data.organization_id,
        participant_id: data.participant_id,
      },
    });
    if (updateUserError) {
      return NextResponse.json({ success: false, error: "Gagal memperbarui sesi client." }, { status: 500 });
    }
  } else {
    const { data: newUser, error: createError } = await db.auth.admin.createUser({
      email: clientEmail,
      password: clientPassword,
      email_confirm: true,
      app_metadata: { role: "client", access_code_id: data.id, organization_id: data.organization_id, participant_id: data.participant_id },
      user_metadata: {
        company_name: data.company_name,
        team_name: data.team_name,
        access_code_id: data.id,
        organization_id: data.organization_id,
        participant_id: data.participant_id,
      },
    });

    if (createError || !newUser?.user) {
      return NextResponse.json({ success: false, error: "Gagal membuat sesi client." }, { status: 500 });
    }
    userId = newUser.user.id;
  }

  if (data.auth_user_id !== userId) {
    const { error: linkError } = await db
      .from("app_client_access_codes")
      .update({ auth_user_id: userId })
      .eq("id", data.id);
    if (linkError) {
      return NextResponse.json({ success: false, error: "Gagal menautkan akun client." }, { status: 500 });
    }
  }

  const { data: sessionData, error: signInError } = await db.auth.signInWithPassword({
    email: clientEmail,
    password: clientPassword,
  });

  if (signInError || !sessionData?.session) {
    return NextResponse.json({ success: false, error: "Gagal membuat sesi." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    client: {
      companyName: data.company_name,
      teamName: data.team_name,
      organizationId: data.organization_id,
      participantId: data.participant_id,
    },
    session: {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_at: sessionData.session.expires_at,
    },
  });
}
