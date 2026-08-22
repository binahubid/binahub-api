import { NextRequest, NextResponse } from "next/server";
import { requireTransformationAdmin } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";
import { z } from "zod";
import { createOpaqueToken } from "@/lib/secure-token";
import { createParticipantCode, hashParticipantCode, participantCodeHint } from "@/lib/participant-code";

const mutationSchema = z.object({
  engagementId: z.string().uuid(),
  accessId: z.string().uuid(),
  action: z.enum(["regenerate", "deactivate", "resolve_review"]),
});

export async function GET(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  if (!engagementId) {
    return NextResponse.json({ success: false, error: "engagement_id wajib diisi." }, { status: 400 });
  }

  try {
    const { data, error } = await getDb()
      .from("app_client_access_codes")
      .select("id, team_name, participant_id, is_active, created_at, last_used_at, participant_code_hint, participant_code_issued_at, participant_code_rotated_at, identity_review_required, identity_review_note, credential_version")
      .eq("program_id", engagementId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      success: true,
      accessCodes: (data || []).map((row) => ({
        id: row.id,
        participant_id: row.participant_id,
        participant_name: row.team_name,
        code_hint: row.participant_code_hint,
        is_active: row.is_active,
        created_at: row.created_at,
        issued_at: row.participant_code_issued_at,
        rotated_at: row.participant_code_rotated_at,
        last_used_at: row.last_used_at,
        identity_review_required: row.identity_review_required,
        identity_review_note: row.identity_review_note,
        credential_version: row.credential_version,
      })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal mengambil kode akses." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationAdmin(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  const parsed = mutationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Permintaan tidak valid." }, { status: 400 });
  }

  const db = getDb();
  const { data: access, error: accessError } = await db
    .from("app_client_access_codes")
    .select("id, auth_user_id, credential_version")
    .eq("id", parsed.data.accessId)
    .eq("program_id", parsed.data.engagementId)
    .maybeSingle();
  if (accessError) return NextResponse.json({ success: false, error: accessError.message }, { status: 500 });
  if (!access) return NextResponse.json({ success: false, error: "Peserta tidak ditemukan pada program ini." }, { status: 404 });

  if (parsed.data.action === "deactivate") {
    const nextVersion = Number(access.credential_version || 1) + 1;
    const { error } = await db.from("app_client_access_codes").update({
      is_active: false,
      credential_version: nextVersion,
    }).eq("id", access.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, isActive: false });
  }

  if (parsed.data.action === "resolve_review") {
    const { error } = await db.from("app_client_access_codes").update({
      identity_review_required: false,
      identity_review_note: null,
    }).eq("id", access.id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const code = createParticipantCode();
  const nextVersion = Number(access.credential_version || 1) + 1;
  const now = new Date().toISOString();
  const { error: updateError } = await db.from("app_client_access_codes").update({
    code_hash: hashParticipantCode(code),
    participant_code_hint: participantCodeHint(code),
    participant_code_issued_at: now,
    participant_code_rotated_at: now,
    credential_version: nextVersion,
    is_active: true,
  }).eq("id", access.id);
  if (updateError) return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });

  if (access.auth_user_id) {
    const { data: userData } = await db.auth.admin.getUserById(access.auth_user_id);
    if (userData.user) {
      const metadata = { ...(userData.user.app_metadata || {}), credential_version: nextVersion };
      const { error: userError } = await db.auth.admin.updateUserById(access.auth_user_id, {
        password: createOpaqueToken(),
        app_metadata: metadata,
      });
      if (userError) {
        await db.from("app_client_access_codes").update({ is_active: false }).eq("id", access.id);
        return NextResponse.json({ success: false, error: "Kode dibuat tetapi sesi lama gagal dicabut. Akses dinonaktifkan untuk keamanan." }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true, participantCode: code, codeHint: participantCodeHint(code), isActive: true });
}
