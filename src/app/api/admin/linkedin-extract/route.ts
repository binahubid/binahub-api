import { NextRequest, NextResponse } from "next/server";
import { extractLinkedInProfileFields } from "@/lib/ai-service";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const body = await req.json();
  const linkedinUrl = String(body.linkedinUrl || "").trim();
  const profileText = String(body.profileText || "").trim();

  if (!linkedinUrl.includes("linkedin.com/")) {
    return NextResponse.json({ success: false, error: "URL LinkedIn tidak valid." }, { status: 400 });
  }

  if (profileText.length < 120) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Ekstraksi aman membutuhkan teks profil atau export LinkedIn. Direct crawling LinkedIn tidak dijalankan karena membutuhkan izin/API resmi LinkedIn.",
      },
      { status: 400 }
    );
  }

  const extracted = await extractLinkedInProfileFields({ linkedinUrl, profileText });
  return NextResponse.json({ success: true, extracted, extractedBy: admin.email });
}
