import { NextResponse } from "next/server";
import { getClientAccess } from "@/lib/client-access";

export async function GET() {
  const access = await getClientAccess();
  if (!access) {
    return NextResponse.json({ success: false, error: "Akses client tidak valid" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    client: {
      companyName: access.company_name,
      teamName: access.team_name,
    },
  });
}

