import "server-only";
import { z } from "zod";
import { callAms } from "@/lib/ams-client";
import { createServerSupabase } from "@/lib/supabase";

export class ConsultantMembershipError extends Error {
  constructor(public code: "CONSULTANT_FORBIDDEN" | "CONSULTANT_AMS_UNAVAILABLE") { super(code); }
}

export async function assertActiveConsultantMembership(profileId: string) {
  const { data: member, error } = await createServerSupabase().from("consultant_members")
    .select("active,email,ams_associate_id,ams_membership_id,ams_status,agreement_accepted_at").eq("user_id", profileId).maybeSingle();
  if (error) throw new ConsultantMembershipError("CONSULTANT_AMS_UNAVAILABLE");
  if (!member?.active || !member.ams_associate_id || !member.ams_membership_id
    || member.ams_status !== "active" || !member.agreement_accepted_at)
    throw new ConsultantMembershipError("CONSULTANT_FORBIDDEN");
  let response;
  try {
    response = z.object({ success: z.literal(true), active: z.boolean() }).parse(await callAms(
      "/api/integrations/app/consultant-team/check",
      { associateId: member.ams_associate_id, membershipId: member.ams_membership_id, email: member.email },
    ));
  } catch { throw new ConsultantMembershipError("CONSULTANT_AMS_UNAVAILABLE"); }
  if (!response.active) throw new ConsultantMembershipError("CONSULTANT_FORBIDDEN");
}
