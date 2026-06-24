import { NextRequest, NextResponse } from "next/server";
import { hashAccessCode } from "@/lib/client-access";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const code = String(body.code || "").trim();

  if (!code) {
    return NextResponse.json({ success: false, error: "Kode akses wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id")
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
  const clientPassword = `binahub-client-${data.id}`;

  const { data: existingUsers } = await db.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email === clientEmail);

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    await db.auth.admin.updateUserById(userId, {
      app_metadata: { role: "client", access_code_id: data.id, organization_id: data.organization_id, participant_id: data.participant_id },
      user_metadata: {
        company_name: data.company_name,
        team_name: data.team_name,
        access_code_id: data.id,
        organization_id: data.organization_id,
        participant_id: data.participant_id,
      },
    });
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

