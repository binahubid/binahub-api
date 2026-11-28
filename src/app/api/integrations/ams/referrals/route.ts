import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAmsSignature } from "@/lib/ams-integration";
import { lookupReferral, referralAssociateIsActive, referralCode, referralRpc } from "@/lib/referrals";

const filters = {
  status: z.enum(["incoming", "verified", "in_progress", "won", "completed", "closed", "review", "success"]).optional(),
  source: z.enum(["recommendation", "team_diagnosis", "individual_diagnosis", "inquiry", "booking"]).optional(),
  page: z.number().int().min(1).max(500).default(1),
};
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), associateId: z.uuid(), ...filters }).strict(),
  z.object({ action: z.literal("settings"), associateId: z.uuid(), email: z.email(), operation: z.enum(["load", "enable", "disable", "rotate"]), expectedCode: referralCode.optional() }).strict(),
  z.object({ action: z.literal("follow_up"), associateId: z.uuid(), caseId: z.uuid(), requestId: z.uuid(), note: z.string().trim().max(1000), revisitOn: z.iso.date().nullable(), help: z.boolean() }).strict(),
  z.object({ action: z.literal("admin_list"), adminId: z.uuid(), ownerId: z.uuid().optional(), ...filters }).strict(),
  z.object({ action: z.literal("admin_review"), adminId: z.uuid(), caseId: z.uuid(), status: z.enum(["verified", "rejected"]), code: referralCode.optional(), reason: z.string().trim().min(3).max(500), expectedAt: z.iso.datetime({ offset: true }) }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > 8192) {
    return NextResponse.json({ success: false, error: "Permintaan referral terlalu besar." }, { status: 413, headers });
  }
  const verification = verifyAmsSignature(raw, request.headers.get("x-binahub-timestamp"), request.headers.get("x-binahub-signature"));
  if (!verification.ok) return NextResponse.json({ success: false, error: verification.error }, { status: verification.status, headers });
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid." }, { status: 400, headers });
  }
  const parsed = command.safeParse(decoded);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Permintaan referral tidak valid." }, { status: 400, headers });
  }

  const input = parsed.data;
  try {
    switch (input.action) {
      case "list":
      case "admin_list": {
        const admin = input.action === "admin_list";
        const data = await referralRpc("referral_dashboard", {
          p_associate: admin ? null : input.associateId, p_admin: admin,
          p_status: input.status || null, p_source: input.source || null,
          p_owner: admin ? input.ownerId || null : null,
          p_offset: (input.page - 1) * 20, p_limit: 20,
        });
        return NextResponse.json({ success: true, data }, { headers });
      }
      case "settings": {
        const data = await referralRpc("referral_code_settings", {
          p_associate: input.associateId, p_email: input.email,
          p_action: input.operation, p_expected_code: input.expectedCode || null,
        });
        return NextResponse.json({ success: true, data }, { headers });
      }
      case "follow_up":
        await referralRpc("referral_add_follow_up", {
          p_associate: input.associateId, p_case: input.caseId, p_id: input.requestId,
          p_note: input.note, p_revisit: input.revisitOn, p_help: input.help,
        });
        return NextResponse.json({ success: true }, { headers });
      case "admin_review": {
        if (input.status === "verified") {
          const owner = input.code ? await lookupReferral(null, input.code) : null;
          if (!owner || !await referralAssociateIsActive(owner.associateId)) {
            return NextResponse.json({ success: true, errorCode: "REFERRAL_CODE_INVALID" }, { headers });
          }
        }
        await referralRpc("referral_review", {
          p_admin: input.adminId, p_case: input.caseId, p_status: input.status,
          p_code: input.code || null, p_reason: input.reason, p_expected_at: input.expectedAt,
        });
        return NextResponse.json({ success: true }, { headers });
      }
    }
  } catch (error) {
    const message = typeof error === "object" && error !== null && "message" in error ? error.message : "";
    if (typeof message === "string" && /^REFERRAL_(INVALID|NOT_FOUND|CHANGED|CODE_CHANGED|CODE_INVALID|SELF|CONSENT_REQUIRED)$/.test(message)) {
      return NextResponse.json({ success: true, errorCode: message }, { headers });
    }
    console.error("[AMS referrals]", input.action);
    return NextResponse.json({ success: false, error: "Referral belum dapat diakses." }, { status: 503, headers });
  }
}
