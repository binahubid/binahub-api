import "server-only";
import { z } from "zod";
import { callAms } from "@/lib/ams-client";
import { ConsultantError, consultantRPC } from "./http";

type Member = { user_id: string; display_name: string; email: string };
const emailSchema = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
const responseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({ id: z.string().uuid(), email: emailSchema })),
});

async function verifyAmsAccounts(emails: string[]) {
  const validEmails = [...new Set(emails.flatMap((value) => {
    const parsed = emailSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }))];
  const accounts = new Map<string, string>();
  try {
    for (let i = 0; i < validEmails.length; i += 100) {
      const batch = validEmails.slice(i, i + 100);
      const response = responseSchema.parse(await callAms(
        "/api/integrations/app/associates/eligible", { emails: batch },
      ));
      const seen = new Set<string>();
      for (const { id, email } of response.data) {
        if (!batch.includes(email) || seen.has(email)) throw new Error("Invalid AMS directory response");
        seen.add(email);
        accounts.set(email, id);
      }
    }
  } catch {
    throw new ConsultantError("CONSULTANT_AMS_UNAVAILABLE", 503);
  }
  return accounts;
}

export async function listEligibleConsultants() {
  const members = await consultantRPC<Member[]>("consultant_ams_roster");
  const accounts = await verifyAmsAccounts(members.map((member) => member.email));
  return members.filter((member) => accounts.has(member.email)).map((member) => ({
    id: member.user_id, name: member.display_name,
  }));
}

export async function verifyConsultantAssignee(userId: string) {
  const [member] = await consultantRPC<Member[]>("consultant_ams_roster", { p_user_id: userId });
  if (!member) throw new ConsultantError("CONSULTANT_INVALID_MEMBER", 409);
  const amsAssociateId = (await verifyAmsAccounts([member.email])).get(member.email);
  if (!amsAssociateId) throw new ConsultantError("CONSULTANT_AMS_REQUIRED", 409);
  return { amsAssociateId, verifiedAmsEmail: member.email };
}
