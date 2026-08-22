import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { hashAccessCode } from "@/lib/client-access";
import { createServerSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createOpaqueToken } from "@/lib/secure-token";
import { participantAccessExpiry, programAccessAvailable, publicProgram, type ClientProgramRow } from "@/lib/client-program";

const accessSchema = z.object({
  code: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(2).max(120).optional(),
  programId: z.string().uuid().optional(),
});

const previewSchema = z.object({ program: z.string().uuid() });

interface AccessRow {
  id: string;
  company_name: string;
  team_name: string;
  expires_at: string | null;
  is_active: boolean;
  organization_id: string | null;
  participant_id: string | null;
  program_id: string | null;
  auth_user_id: string | null;
}

async function getEnabledModules(db: ReturnType<typeof createServerSupabase>, programId: string) {
  const { data, error } = await db
    .from("program_modules")
    .select("module_key")
    .eq("program_id", programId)
    .eq("enabled", true);
  if (error) throw new Error("Gagal memuat modul program.");
  return (data || []).map((module) => module.module_key as "tbos" | "lep");
}

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

async function createProgramParticipantAccess(
  db: ReturnType<typeof createServerSupabase>,
  program: ClientProgramRow,
  displayName: string,
): Promise<AccessRow> {
  const { data: organization, error: organizationError } = await db
    .from("organizations")
    .select("name")
    .eq("id", program.organization_id)
    .single();
  if (organizationError || !organization) throw new Error("Organisasi program tidak ditemukan.");

  const { data: participant, error: participantError } = await db
    .from("participants")
    .insert({ organization_id: program.organization_id, name: displayName })
    .select("id")
    .single();
  if (participantError || !participant) throw new Error(participantError?.message || "Gagal membuat profil peserta.");

  const { error: membershipError } = await db.from("engagement_participants").insert({
    engagement_id: program.id,
    participant_id: participant.id,
    role: "participant",
  });
  if (membershipError) {
    await db.from("participants").delete().eq("id", participant.id);
    throw new Error(membershipError.message);
  }

  const { data: access, error: accessError } = await db
    .from("app_client_access_codes")
    .insert({
      company_name: organization.name,
      team_name: displayName,
      code_hash: hashAccessCode(createOpaqueToken()),
      is_active: true,
      organization_id: program.organization_id,
      participant_id: participant.id,
      program_id: program.id,
      expires_at: participantAccessExpiry(program.end_date),
    })
    .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id, program_id, auth_user_id")
    .single();
  if (accessError || !access) {
    await db.from("engagement_participants").delete().eq("engagement_id", program.id).eq("participant_id", participant.id);
    await db.from("participants").delete().eq("id", participant.id);
    throw new Error(accessError?.message || "Gagal membuat akses peserta.");
  }

  return access as AccessRow;
}

async function createClientSession(db: ReturnType<typeof createServerSupabase>, access: AccessRow) {
  const clientEmail = `client-${access.id}@binahub.local`;
  const clientPassword = createOpaqueToken();
  const metadata = {
    role: "client",
    access_code_id: access.id,
    organization_id: access.organization_id,
    participant_id: access.participant_id,
    program_id: access.program_id,
  };

  let existingUser: User | null = null;
  if (access.auth_user_id) {
    const { data: existing, error } = await db.auth.admin.getUserById(access.auth_user_id);
    if (error && error.status !== 404) throw new Error("Gagal memeriksa akun client.");
    existingUser = existing.user;
  } else if (!access.program_id) {
    existingUser = await findLegacyUserByEmail(db, clientEmail);
  }

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    const { error } = await db.auth.admin.updateUserById(userId, {
      password: clientPassword,
      app_metadata: metadata,
      user_metadata: { ...metadata, company_name: access.company_name, team_name: access.team_name },
    });
    if (error) throw new Error("Gagal memperbarui sesi client.");
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: clientEmail,
      password: clientPassword,
      email_confirm: true,
      app_metadata: metadata,
      user_metadata: { ...metadata, company_name: access.company_name, team_name: access.team_name },
    });
    if (error || !data.user) throw new Error("Gagal membuat sesi client.");
    userId = data.user.id;
  }

  const { error: profileError } = await db.from("profiles").upsert({
    id: userId,
    full_name: access.team_name,
    role: "client",
    organization_id: access.organization_id,
  }, { onConflict: "id" });
  if (profileError) throw new Error("Gagal menyiapkan profil client.");

  if (access.participant_id) {
    const { error: participantLinkError } = await db
      .from("participants")
      .update({ profile_id: userId })
      .eq("id", access.participant_id)
      .is("profile_id", null);
    if (participantLinkError) throw new Error("Gagal menautkan profil peserta.");
  }

  if (access.auth_user_id !== userId) {
    const { error } = await db.from("app_client_access_codes").update({ auth_user_id: userId }).eq("id", access.id);
    if (error) throw new Error("Gagal menautkan akun client.");
  }

  const { data: sessionData, error: signInError } = await db.auth.signInWithPassword({
    email: clientEmail,
    password: clientPassword,
  });
  if (signInError || !sessionData.session) throw new Error("Gagal membuat sesi.");
  return sessionData.session;
}

async function rollbackProgramParticipantAccess(db: ReturnType<typeof createServerSupabase>, access: AccessRow) {
  const { data: persisted } = await db
    .from("app_client_access_codes")
    .select("auth_user_id")
    .eq("id", access.id)
    .maybeSingle();

  await db.from("app_client_access_codes").delete().eq("id", access.id);
  if (persisted?.auth_user_id) {
    const { error } = await db.auth.admin.deleteUser(persisted.auth_user_id);
    if (error) console.error("[Client Access] Failed to remove incomplete auth user:", error.message);
  }
  if (access.program_id && access.participant_id) {
    await db.from("engagement_participants").delete().eq("engagement_id", access.program_id).eq("participant_id", access.participant_id);
  }
  if (access.participant_id) await db.from("participants").delete().eq("id", access.participant_id);
}

export async function GET(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "client-program-preview", 1000, 15 * 60);
  if (rateLimited) return rateLimited;

  const parsed = previewSchema.safeParse({ program: req.nextUrl.searchParams.get("program") });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Tautan program tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("engagements")
    .select("id, title, code, organization_id, status, start_date, end_date, location, organization:organizations(name)")
    .eq("id", parsed.data.program)
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, error: "Gagal memuat program." }, { status: 500 });
  if (!data || data.status === "archived") {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }

  try {
    const modules = await getEnabledModules(db, data.id);
    return NextResponse.json(
      { success: true, program: publicProgram(data as ClientProgramRow, modules) },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat program." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const parsed = accessSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Kode akses wajib diisi." }, { status: 400 });
  }

  const rateLimited = await enforceRateLimit(req, `client-access:${parsed.data.programId || "generic"}`, 1000, 15 * 60);
  if (rateLimited) return rateLimited;

  const db = createServerSupabase();
  const normalizedCode = parsed.data.code.toUpperCase();
  let access: AccessRow | null = null;
  let program: ClientProgramRow | null = null;
  let createdProgramAccess = false;

  if (parsed.data.programId) {
    const { data, error } = await db
      .from("engagements")
      .select("id, code, title, organization_id, status, start_date, end_date, location, organization:organizations(name)")
      .eq("id", parsed.data.programId)
      .in("status", ["active", "in_progress", "review"])
      .maybeSingle();
    if (error || !data || data.code?.trim().toUpperCase() !== normalizedCode) {
      const failedLimit = await enforceRateLimit(req, `client-access-failed:${parsed.data.programId}`, 100, 15 * 60);
      if (failedLimit) return failedLimit;
      return NextResponse.json({ success: false, error: "Kode program tidak valid atau program belum aktif." }, { status: 401 });
    }
    program = data as ClientProgramRow;
  } else {
    const { data: legacyAccess, error: accessError } = await db
      .from("app_client_access_codes")
      .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id, program_id, auth_user_id")
      .eq("code_hash", hashAccessCode(normalizedCode))
      .eq("is_active", true)
      .maybeSingle();
    if (accessError) {
      return NextResponse.json({ success: false, error: "Gagal memeriksa kode akses." }, { status: 500 });
    }
    access = legacyAccess as AccessRow | null;

    if (!access) {
      const { data, error } = await db
        .from("engagements")
        .select("id, code, title, organization_id, status, start_date, end_date, location, organization:organizations(name)")
        .ilike("code", normalizedCode)
        .in("status", ["active", "in_progress", "review"])
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        const failedLimit = await enforceRateLimit(req, "client-access-failed:generic", 25, 15 * 60);
        if (failedLimit) return failedLimit;
        return NextResponse.json({ success: false, error: "Kode program tidak valid atau program belum aktif." }, { status: 401 });
      }
      program = data as ClientProgramRow;
    }
  }

  if (!access && program) {
    if (!parsed.data.displayName) {
      try {
        const modules = await getEnabledModules(db, program.id);
        return NextResponse.json({ success: true, needsProfile: true, program: publicProgram(program, modules) });
      } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat modul program." }, { status: 500 });
      }
    }

    if (!programAccessAvailable(program)) {
      return NextResponse.json({ success: false, error: "Masa akses program telah berakhir." }, { status: 403 });
    }

    try {
      access = await createProgramParticipantAccess(db, program, parsed.data.displayName);
      createdProgramAccess = true;
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal mendaftarkan peserta." }, { status: 500 });
    }
  }

  if (!access) return NextResponse.json({ success: false, error: "Akses program tidak ditemukan." }, { status: 401 });

  if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ success: false, error: "Kode akses sudah kedaluwarsa." }, { status: 401 });
  }

  try {
    const session = await createClientSession(db, access);
    return NextResponse.json({
      success: true,
      redirectPath: access.program_id ? "/client/program" : "/client/dashboard",
      client: {
        companyName: access.company_name,
        displayName: access.team_name,
        organizationId: access.organization_id,
        participantId: access.participant_id,
        programId: access.program_id,
      },
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      },
    });
  } catch (error) {
    console.error("[Client Access] Session setup failed:", error);
    if (createdProgramAccess && access) await rollbackProgramParticipantAccess(db, access);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat sesi client." }, { status: 500 });
  }
}
