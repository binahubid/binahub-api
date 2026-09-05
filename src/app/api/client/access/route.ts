import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase";
import { enforceRateLimit, requestFingerprint } from "@/lib/rate-limit";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/secure-token";
import { participantAccessExpiry, programAccessAvailable, publicProgram, type ClientProgramRow } from "@/lib/client-program";
import { findSimilarParticipantNames, matchingParticipantAccesses } from "@/lib/participant-identity";
import { createParticipantCode, hashParticipantCode, normalizeParticipantCode, participantCodeHint } from "@/lib/participant-code";
import type { ProgramModuleKey } from "@/lib/program-modules";

const accessSchema = z.object({
  mode: z.enum(["register", "participant"]).optional().default("register"),
  code: z.string().trim().min(1).max(128).optional(),
  participantCode: z.string().trim().min(8).max(32).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  programId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.mode === "register" && !value.code) {
    context.addIssue({ code: "custom", path: ["code"], message: "Kode program wajib diisi." });
  }
  if (value.mode === "participant" && !value.participantCode) {
    context.addIssue({ code: "custom", path: ["participantCode"], message: "Kode peserta wajib diisi." });
  }
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
  credential_version: number;
}

interface ParticipantRegistrationRow {
  access_id: string;
  participant_id: string;
  company_name: string;
  organization_id: string;
  program_id: string;
  expires_at: string | null;
  credential_version: number;
}

const DEVICE_COOKIE = "binahub_participant_device";

function participantDevice(req: NextRequest) {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const token = existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing) ? existing : createOpaqueToken();
  return { token, hash: hashOpaqueToken(token), shouldSetCookie: token !== existing };
}

async function getEnabledModules(db: ReturnType<typeof createServerSupabase>, programId: string) {
  const { data, error } = await db
    .from("program_modules")
    .select("module_key")
    .eq("program_id", programId)
    .eq("enabled", true);
  if (error) throw new Error("Gagal memuat modul program.");
  return (data || []).map((module) => module.module_key as ProgramModuleKey);
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
  registration: {
    deviceHash: string;
    ipHash: string;
    identityReviewRequired: boolean;
    identityReviewNote: string | null;
  },
): Promise<{ access: AccessRow; participantCode: string }> {
  const participantCode = createParticipantCode();
  const expiresAt = participantAccessExpiry(program.end_date);
  const { data, error } = await db
    .rpc("register_program_participant", {
      p_program_id: program.id,
      p_display_name: displayName,
      p_code_hash: hashParticipantCode(participantCode),
      p_code_hint: participantCodeHint(participantCode),
      p_expires_at: expiresAt,
      p_device_hash: registration.deviceHash,
      p_ip_hash: registration.ipHash,
      p_identity_review_required: registration.identityReviewRequired,
      p_identity_review_note: registration.identityReviewNote,
    })
    .single();
  if (error || !data) throw new Error(error?.message || "Gagal membuat akses peserta.");

  const registrationRow = data as ParticipantRegistrationRow;
  const access: AccessRow = {
    id: registrationRow.access_id,
    company_name: registrationRow.company_name,
    team_name: displayName,
    expires_at: registrationRow.expires_at,
    is_active: true,
    organization_id: registrationRow.organization_id,
    participant_id: registrationRow.participant_id,
    program_id: registrationRow.program_id,
    auth_user_id: null,
    credential_version: registrationRow.credential_version,
  };

  return { access, participantCode };
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
    credential_version: access.credential_version,
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
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Data akses tidak valid." }, { status: 400 });
  }

  // Program events commonly place many participants behind one venue/Wi-Fi IP.
  // Keep a broad IP ceiling here; tighter limits below include the attempted credential/device.
  const rateLimited = await enforceRateLimit(req, `client-access:${parsed.data.mode}:${parsed.data.programId || "generic"}`, 300, 15 * 60);
  if (rateLimited) return rateLimited;

  const db = createServerSupabase();
  let access: AccessRow | null = null;
  let participantCode: string | null = null;
  let createdProgramAccess = false;
  let deviceCookie: ReturnType<typeof participantDevice> | null = null;

  if (parsed.data.mode === "participant") {
    const normalizedParticipantCode = normalizeParticipantCode(parsed.data.participantCode || "");
    const { data: participantAccess, error: participantAccessError } = await db
      .from("app_client_access_codes")
      .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id, program_id, auth_user_id, credential_version")
      .eq("code_hash", hashParticipantCode(normalizedParticipantCode))
      .eq("is_active", true)
      .maybeSingle();

    const wrongProgram = parsed.data.programId
      && participantAccess?.program_id
      && participantAccess.program_id !== parsed.data.programId;
    if (participantAccessError || !participantAccess || wrongProgram) {
      const attemptedCodeHash = hashParticipantCode(normalizedParticipantCode).slice(0, 16);
      const failedLimit = await enforceRateLimit(req, `participant-code-failed:${attemptedCodeHash}`, 8, 15 * 60);
      if (failedLimit) return failedLimit;
      return NextResponse.json({ success: false, error: "Kode peserta tidak valid atau sudah dinonaktifkan." }, { status: 401 });
    }

    access = participantAccess as AccessRow;
    if (!access.program_id) {
      return NextResponse.json({ success: false, error: "Kode peserta belum terhubung ke program. Hubungi admin." }, { status: 409 });
    }
    const { data: accessProgram, error: accessProgramError } = await db
      .from("engagements")
      .select("status, end_date")
      .eq("id", access.program_id)
      .maybeSingle();
    if (accessProgramError || !accessProgram || !programAccessAvailable(accessProgram)) {
      return NextResponse.json({ success: false, error: "Program tidak sedang menerima akses peserta." }, { status: 403 });
    }
  } else {
    const normalizedProgramCode = (parsed.data.code || "").toUpperCase();
    let program: (ClientProgramRow & { participant_limit?: number }) | null = null;

    if (parsed.data.programId) {
      const { data, error } = await db
        .from("engagements")
        .select("id, code, title, organization_id, status, start_date, end_date, location, participant_limit, organization:organizations(name)")
        .eq("id", parsed.data.programId)
        .in("status", ["active", "in_progress", "review"])
        .maybeSingle();
      if (error || !data || data.code?.trim().toUpperCase() !== normalizedProgramCode) {
        const attemptedCodeHash = hashOpaqueToken(normalizedProgramCode).slice(0, 16);
        const failedLimit = await enforceRateLimit(req, `program-code-failed:${parsed.data.programId}:${attemptedCodeHash}`, 8, 15 * 60);
        if (failedLimit) return failedLimit;
        return NextResponse.json({ success: false, error: "Kode program tidak valid atau program belum aktif." }, { status: 401 });
      }
      program = data as ClientProgramRow & { participant_limit?: number };
    } else {
      const { data, error } = await db
        .from("engagements")
        .select("id, code, title, organization_id, status, start_date, end_date, location, participant_limit, organization:organizations(name)")
        .ilike("code", normalizedProgramCode)
        .in("status", ["active", "in_progress", "review"])
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        const attemptedCodeHash = hashOpaqueToken(normalizedProgramCode).slice(0, 16);
        const failedLimit = await enforceRateLimit(req, `program-code-failed:generic:${attemptedCodeHash}`, 8, 15 * 60);
        if (failedLimit) return failedLimit;
        return NextResponse.json({ success: false, error: "Kode program tidak valid atau program belum aktif." }, { status: 401 });
      }
      program = data as ClientProgramRow & { participant_limit?: number };
    }

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

    deviceCookie = participantDevice(req);
    const registrationLimit = await enforceRateLimit(
      req,
      `participant-registration:${program.id}:${deviceCookie.hash}`,
      5,
      15 * 60,
    );
    if (registrationLimit) return registrationLimit;

    const [{ data: programAccesses, error: existingAccessError }, { count: participantCount, error: participantCountError }] = await Promise.all([
      db
        .from("app_client_access_codes")
        .select("id, company_name, team_name, expires_at, is_active, organization_id, participant_id, program_id, auth_user_id, credential_version, registration_device_hash")
        .eq("program_id", program.id),
      db
        .from("engagement_participants")
        .select("participant_id", { count: "exact", head: true })
        .eq("engagement_id", program.id),
    ]);
    if (existingAccessError || participantCountError) {
      return NextResponse.json({ success: false, error: "Gagal memeriksa data peserta program." }, { status: 500 });
    }
    if ((participantCount || 0) >= (program.participant_limit || 100)) {
      return NextResponse.json({ success: false, error: "Kapasitas peserta program sudah penuh. Hubungi admin program." }, { status: 409 });
    }
    if ((programAccesses || []).some((row) => row.registration_device_hash === deviceCookie?.hash)) {
      return NextResponse.json({
        success: false,
        error: "Perangkat ini sudah digunakan untuk mendaftarkan peserta pada program. Gunakan kode peserta untuk masuk kembali.",
        code: "DEVICE_ALREADY_REGISTERED",
      }, { status: 409 });
    }

    const displayName = parsed.data.displayName.replace(/\s+/g, " ").trim();
    const matchingAccesses = matchingParticipantAccesses(programAccesses || [], displayName);
    if (matchingAccesses.length > 0) {
      return NextResponse.json({
        success: false,
        error: "Nama tersebut sudah terdaftar. Gunakan kode peserta untuk masuk kembali atau hubungi admin jika kode hilang.",
        code: "PARTICIPANT_NAME_EXISTS",
      }, { status: 409 });
    }

    const similarNames = findSimilarParticipantNames((programAccesses || []).map((row) => row.team_name), displayName);
    try {
      const created = await createProgramParticipantAccess(db, program, displayName, {
        deviceHash: deviceCookie.hash,
        ipHash: requestFingerprint(req, `participant-registration-log:${program.id}`),
        identityReviewRequired: similarNames.length > 0,
        identityReviewNote: similarNames.length > 0
          ? `Nama mirip yang sudah terdaftar: ${similarNames.slice(0, 3).join(", ")}`
          : null,
      });
      access = created.access;
      participantCode = created.participantCode;
      createdProgramAccess = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal mendaftarkan peserta.";
      const duplicateDevice = /program_device_unique|duplicate key/i.test(message);
      const businessConflict = /kapasitas peserta|sudah terdaftar|perangkat ini sudah digunakan/i.test(message);
      return NextResponse.json({
        success: false,
        error: duplicateDevice
          ? "Perangkat ini sudah digunakan untuk mendaftarkan peserta pada program."
          : message,
      }, { status: duplicateDevice || businessConflict ? 409 : 500 });
    }
  }

  if (!access) return NextResponse.json({ success: false, error: "Akses program tidak ditemukan." }, { status: 401 });

  if (access.expires_at && new Date(access.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ success: false, error: "Kode akses sudah kedaluwarsa." }, { status: 401 });
  }

  try {
    const session = await createClientSession(db, access);
    await db.from("app_client_access_codes").update({ last_used_at: new Date().toISOString() }).eq("id", access.id);
    const response = NextResponse.json({
      success: true,
      isNewParticipant: createdProgramAccess,
      participantCode,
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
    if (createdProgramAccess && deviceCookie?.shouldSetCookie) {
      response.cookies.set(DEVICE_COOKIE, deviceCookie.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch (error) {
    console.error("[Client Access] Session setup failed:", error);
    if (createdProgramAccess && access) await rollbackProgramParticipantAccess(db, access);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat sesi client." }, { status: 500 });
  }
}
