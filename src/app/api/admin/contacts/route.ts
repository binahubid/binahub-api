import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { contactUpdateSchema } from "@/lib/admin-mutation-schemas";

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, contactUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_CONTACT_UPDATE");
  const { id, status, notes } = parsed.data;

  const { data, error } = await createServerSupabase()
    .from("leads")
    .update({
      lead_status: status,
      notes,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, contact: data });
}
