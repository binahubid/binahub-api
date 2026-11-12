import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  consultantRPC,
} from "@/lib/consultant/http";
import { consultantManagement } from "@/lib/consultant/schemas";
import { listEligibleConsultants, verifyConsultantAssignee } from "@/lib/consultant/ams-eligibility";
export async function GET(req: NextRequest) {
  const a = await requireAdmin(req);
  if ("error" in a) return consultantJson({ error: a.error }, a.status);
  try {
    if (req.nextUrl.searchParams.get("view") === "assignees") {
      return consultantJson({ members: await listEligibleConsultants() });
    }
    const db = createServerSupabase();
    const [members, accounts, bookings] = await Promise.all([
      db.from("consultant_members").select("*").order("display_name"),
      db
        .from("profiles")
        .select("id,full_name,role")
        .in("role", ["consultant", "facilitator", "admin"])
        .order("full_name"),
      db
        .from("calendar_bookings")
        .select("id,title,attendee_name,attendee_email,start_time,status")
        .is("lead_id", null)
        .gte("start_time", new Date().toISOString())
        .order("start_time")
        .limit(100),
    ]);
    if (members.error || accounts.error || bookings.error)
      throw new Error("Unavailable");
    return consultantJson({
      members: members.data,
      accounts: accounts.data,
      bookings: bookings.data,
    });
  } catch (e) {
    return consultantFailure(e);
  }
}
export async function POST(req: NextRequest) {
  const a = await requireAdmin(req);
  if ("error" in a) return consultantJson({ error: a.error }, a.status);
  try {
    const value = consultantManagement.parse(await consultantBody(req));
    const ams = value.action === "assign"
      ? await verifyConsultantAssignee(value.userId)
      : {};
    return consultantJson(
      await consultantRPC("consultant_manage", {
        p_actor: a.userId,
        p_action: value.action,
        p_data: { ...value, ...ams },
      }),
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
