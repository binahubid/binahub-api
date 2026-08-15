import { NextRequest, NextResponse } from "next/server";
import { getClientAccessBySupabaseUser } from "@/lib/client-access";
import { getAuthoritativeUserRole, getUserFromBearer } from "@/lib/auth-role";

export async function GET(req: NextRequest) {
  const bearer = await getUserFromBearer(req);
  if ("error" in bearer) {
    return NextResponse.json({ success: false, error: bearer.error }, { status: bearer.status });
  }

  try {
    const role = await getAuthoritativeUserRole(bearer.user);
    if (role !== "client") {
      return NextResponse.json({ success: false, error: "Akses client tidak valid" }, { status: 403 });
    }

    const access = await getClientAccessBySupabaseUser(bearer.user.id, bearer.user.app_metadata || {});
    if (!access) {
      return NextResponse.json({ success: false, error: "Akses client tidak valid" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      client: {
        companyName: access.company_name,
        teamName: access.team_name,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memverifikasi akses client" },
      { status: 500 },
    );
  }
}
