import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase";
import { z } from "zod";

const associateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(320),
  fullName: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(50),
});

const assignmentSchema = z.object({
  id: z.string().uuid(),
  assigneeId: z.string().uuid(),
  status: z.enum(["invited", "applied", "accepted", "declined", "in_progress", "completed", "reviewed", "withdrawn", "cancelled"]),
  role: z.string().trim().min(1).max(100),
  externalProgramId: z.string().uuid().nullable(),
  moduleKey: z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/).nullable(),
  scope: z.record(z.string(), z.unknown()).default({}),
});

export const amsIntegrationEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum(["identity.synced", "assignment.changed"]),
  occurredAt: z.string().datetime({ offset: true }),
  associate: associateSchema,
  assignment: assignmentSchema.optional(),
}).superRefine((value, context) => {
  if (value.eventType === "assignment.changed" && !value.assignment) {
    context.addIssue({ code: "custom", message: "Assignment wajib tersedia." });
  }
});

export const amsAccessRequestSchema = z.object({
  associate: associateSchema,
  nextPath: z.string().trim().max(300).optional(),
});

export type AmsIntegrationEvent = z.infer<typeof amsIntegrationEventSchema>;
export type AmsAssociateIdentity = z.infer<typeof associateSchema>;

export function verifyAmsSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = process.env.AMS_INTEGRATION_SECRET;
  if (!secret) return { ok: false as const, status: 503, error: "Integrasi AMS belum dikonfigurasi." };
  if (!timestamp || !signature || !/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false as const, status: 401, error: "Tanda tangan integrasi tidak valid." };
  }

  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) {
    return { ok: false as const, status: 401, error: "Permintaan integrasi sudah kedaluwarsa." };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return { ok: false as const, status: 401, error: "Tanda tangan integrasi tidak valid." };
  }

  return { ok: true as const };
}

async function findAuthUserByEmail(email: string) {
  const db = createServerSupabase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Gagal memeriksa identitas APP.");
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) break;
  }
  return null;
}

export async function ensureAmsIdentity(identity: AmsAssociateIdentity, occurredAt = new Date().toISOString()) {
  const db = createServerSupabase();
  const normalizedEmail = identity.email.trim().toLowerCase();
  const { data: existingLink } = await db
    .from("ams_identity_links")
    .select("profile_id, last_event_at")
    .eq("ams_associate_id", identity.id)
    .maybeSingle();

  if (existingLink && new Date(existingLink.last_event_at).getTime() > new Date(occurredAt).getTime()) {
    return { profileId: existingLink.profile_id as string, stale: true };
  }

  let user = await findAuthUserByEmail(normalizedEmail);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: {
        full_name: identity.fullName,
        source: "ams",
        ams_associate_id: identity.id,
      },
    });
    if (error || !data.user) throw new Error("Gagal menyiapkan akun associate di APP.");
    user = data.user;
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error("Gagal memeriksa profil APP.");

  if (!profile) {
    const { error } = await db.from("profiles").insert({
      id: user.id,
      full_name: identity.fullName,
      role: "facilitator",
    });
    if (error) throw new Error("Gagal membuat profil associate di APP.");
  } else {
    // APP masih memakai satu role utama. Pertahankan admin, tetapi pastikan
    // associate AMS memperoleh shell fasilitator; akses program tetap dibatasi
    // oleh tabel assignment per program, bukan oleh role ini saja.
    const { error } = await db.from("profiles").update({
      full_name: identity.fullName,
      role: profile.role === "admin" ? "admin" : "facilitator",
    }).eq("id", user.id);
    if (error) throw new Error("Gagal memperbarui profil associate di APP.");
  }

  const { error: linkError } = await db.from("ams_identity_links").upsert({
    ams_associate_id: identity.id,
    profile_id: user.id,
    email: normalizedEmail,
    full_name: identity.fullName,
    associate_status: identity.status,
    last_event_at: occurredAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "ams_associate_id" });
  if (linkError) throw new Error("Gagal menghubungkan identitas AMS dan APP.");

  return { profileId: user.id, stale: false };
}

const activeStatuses = new Set(["accepted", "in_progress"]);

export async function applyAmsAssignment(event: AmsIntegrationEvent, profileId: string) {
  if (!event.assignment?.externalProgramId || !event.assignment.moduleKey) return { linked: false };
  const db = createServerSupabase();
  const assignment = event.assignment;

  const { data: existingStaff } = await db
    .from("program_staff_assignments")
    .select("id, source_updated_at")
    .eq("ams_assignee_id", assignment.assigneeId)
    .maybeSingle();
  if (existingStaff && new Date(existingStaff.source_updated_at).getTime() > new Date(event.occurredAt).getTime()) {
    return { linked: true, stale: true };
  }

  const [{ data: program }, { data: module }] = await Promise.all([
    db.from("engagements").select("id").eq("id", assignment.externalProgramId).maybeSingle(),
    db.from("program_modules").select("program_id").eq("program_id", assignment.externalProgramId).eq("module_key", assignment.moduleKey).eq("enabled", true).maybeSingle(),
  ]);
  if (!program || !module) throw new Error("Program atau modul APP untuk assignment tidak tersedia.");

  const { data: staff, error: staffError } = await db.from("program_staff_assignments").upsert({
    ams_assignment_id: assignment.id,
    ams_assignee_id: assignment.assigneeId,
    ams_associate_id: event.associate.id,
    profile_id: profileId,
    program_id: assignment.externalProgramId,
    module_key: assignment.moduleKey,
    role_key: assignment.role,
    status: assignment.status,
    scope: assignment.scope,
    source_updated_at: event.occurredAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "ams_assignee_id" }).select("id").single();
  if (staffError || !staff) throw new Error("Gagal menyinkronkan penugasan program.");

  if (assignment.moduleKey === "tbos") {
    if (activeStatuses.has(assignment.status)) {
      const assignedByProfileId = typeof assignment.scope.assignedByProfileId === "string"
        ? assignment.scope.assignedByProfileId
        : null;
      if (!assignedByProfileId || !z.string().uuid().safeParse(assignedByProfileId).success) {
        throw new Error("Admin pemberi assignment T-BOS tidak tersedia.");
      }
      const { error: assignmentError } = await db.rpc("assign_facilitator_program", {
        p_facilitator_id: profileId,
        p_program_id: assignment.externalProgramId,
        p_assigned_by: assignedByProfileId,
      });
      if (assignmentError) throw new Error("Gagal mengaktifkan akses fasilitator T-BOS.");
      const { error: linkError } = await db.from("facilitator_program_assignments").update({
        staff_assignment_id: staff.id,
        updated_at: new Date().toISOString(),
      }).eq("profile_id", profileId).eq("program_id", assignment.externalProgramId);
      if (linkError) throw new Error("Gagal menghubungkan assignment fasilitator T-BOS.");
    } else {
      const { error } = await db.from("facilitator_program_assignments").delete().eq("staff_assignment_id", staff.id);
      if (error) throw new Error("Gagal mencabut akses fasilitator T-BOS.");
      await db.from("facilitator_missions").delete().eq("profile_id", profileId).eq("program_id", assignment.externalProgramId);
    }
  }

  if (assignment.moduleKey === "lep") {
    if (["accepted", "in_progress", "completed", "reviewed"].includes(assignment.status)) {
      const { data: existingSpeaker } = await db.from("lep_speakers").select("id").eq("staff_assignment_id", staff.id).maybeSingle();
      if (existingSpeaker) {
        const { error } = await db.from("lep_speakers").update({ name: event.associate.fullName, profile_id: profileId, deleted_at: null }).eq("id", existingSpeaker.id);
        if (error) throw new Error("Gagal memperbarui pembicara LEP.");
      } else {
        const { data: lastSpeaker } = await db.from("lep_speakers").select("sort_order").eq("program_id", assignment.externalProgramId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
        const { error } = await db.from("lep_speakers").insert({
          program_id: assignment.externalProgramId,
          name: event.associate.fullName,
          profile_id: profileId,
          staff_assignment_id: staff.id,
          sort_order: Number(lastSpeaker?.sort_order || 0) + 1,
        });
        if (error) throw new Error("Gagal menambahkan pembicara LEP.");
      }
    } else {
      const { error } = await db.from("lep_speakers").update({ deleted_at: new Date().toISOString() }).eq("staff_assignment_id", staff.id);
      if (error) throw new Error("Gagal menonaktifkan pembicara LEP.");
    }
  }

  return { linked: true, staffAssignmentId: staff.id };
}

export async function createAmsAccessTicket(identity: AmsAssociateIdentity, nextPath?: string) {
  const { profileId } = await ensureAmsIdentity(identity);
  const safeNextPath = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/fasilitator/tbos";
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const db = createServerSupabase();
  const { error } = await db.from("ams_login_tickets").insert({
    token_hash: tokenHash,
    profile_id: profileId,
    email: identity.email.trim().toLowerCase(),
    next_path: safeNextPath,
    expires_at: expiresAt,
  });
  if (error) throw new Error("Gagal membuat tautan masuk APP.");

  const appUrl = (process.env.APP_PUBLIC_URL || "https://app.binahub.id").replace(/\/$/, "");
  return { url: `${appUrl}/auth/ams?ticket=${encodeURIComponent(token)}`, expiresAt };
}

export async function claimAmsAccessSession(ticket: string) {
  const db = createServerSupabase();
  const tokenHash = createHash("sha256").update(ticket).digest("hex");
  const { data: claimed, error: claimError } = await db.rpc("claim_ams_login_ticket", {
    p_token_hash: tokenHash,
  });
  const login = Array.isArray(claimed) ? claimed[0] : null;
  if (claimError || !login?.email) return null;

  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: login.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    throw new Error("Gagal menyiapkan sesi APP.");
  }

  return {
    tokenHash: link.properties.hashed_token,
    nextPath: typeof login.next_path === "string" ? login.next_path : "/fasilitator/tbos",
  };
}
