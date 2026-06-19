import { NextRequest, NextResponse } from "next/server";
import { clientAccessCookie, hashAccessCode } from "@/lib/client-access";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const code = String(body.code || "").trim();

  if (!code) {
    return NextResponse.json({ success: false, error: "Kode akses wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, expires_at, is_active")
    .eq("code_hash", hashAccessCode(code))
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ success: false, error: "Kode akses tidak valid." }, { status: 401 });
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ success: false, error: "Kode akses sudah kedaluwarsa." }, { status: 401 });
  }

  const response = NextResponse.json({
    success: true,
    client: {
      companyName: data.company_name,
      teamName: data.team_name,
    },
  });

  response.cookies.set(clientAccessCookie, data.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}

