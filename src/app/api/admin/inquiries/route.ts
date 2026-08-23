import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { inquiryUpdateSchema } from "@/lib/admin-mutation-schemas";

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, inquiryUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_INQUIRY_UPDATE");
  const { id, status, notes, followUpPaused } = parsed.data;

  const { data, error } = await createServerSupabase()
    .from("inquiries")
    .update({
      status,
      admin_notes: notes,
      ...(followUpPaused === undefined ? {} : { follow_up_paused: followUpPaused }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, inquiry: data });
}
