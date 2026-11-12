import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { amsAccessRequestSchema, ensureAmsIdentity, verifyAmsSignature } from "@/lib/ams-integration";
import { createServerSupabase } from "@/lib/supabase";
import { callAms } from "@/lib/ams-client";

const schema = z.object({
  associate: amsAccessRequestSchema.shape.associate,
  membership: z.object({
    id: z.uuid(), revision: z.number().int().positive(),
    status: z.enum(["invited","active","paused","ended","declined"]),
    acceptedAt: z.string().datetime({ offset: true }).nullable(),
    agreementHash: z.string().regex(/^[a-f0-9]{64}$/),
    changedAt: z.string().datetime({ offset: true }),
  }),
});
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > 16000) return NextResponse.json({ success: false }, { status: 413 });
  const signature = verifyAmsSignature(body, req.headers.get("x-binahub-timestamp"), req.headers.get("x-binahub-signature"));
  if (!signature.ok) return NextResponse.json({ success: false, error: signature.error }, { status: signature.status });
  const parsed = schema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Data keanggotaan tidak valid." }, { status: 400 });
  const { associate, membership } = parsed.data, db = createServerSupabase();
  try {
    const { data: existing, error: lookupError } = await db.from("ams_identity_links")
      .select("profile_id").eq("ams_associate_id", associate.id).maybeSingle();
    if (lookupError) throw new Error("UNAVAILABLE");
    if (!existing && membership.status !== "active")
      return NextResponse.json({ success: true, provisioned: false });
    // A delayed activation cannot re-open access after suspension or termination.
    if (membership.status === "active" && associate.status === "active") {
      const check = await callAms<{ success: boolean; active: boolean }>("/api/integrations/app/consultant-team/check",
        { associateId: associate.id, membershipId: membership.id });
      if (!check.success || !check.active) return NextResponse.json({ success: false }, { status: 409 });
    }
    const identity = await ensureAmsIdentity(associate, undefined, "consultant");
    const { error } = await db.rpc("consultant_sync_team", {
      p_profile: identity.profileId, p_associate: associate.id, p_membership: membership.id,
      p_revision: membership.revision, p_status: membership.status, p_accepted: membership.acceptedAt,
      p_hash: membership.agreementHash, p_associate_status: associate.status, p_changed: membership.changedAt,
      p_name: associate.fullName, p_email: associate.email.trim().toLowerCase(),
    });
    if (error) throw new Error("UNAVAILABLE");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "Sinkronisasi keanggotaan belum dapat diselesaikan." }, { status: 503 });
  }
}
