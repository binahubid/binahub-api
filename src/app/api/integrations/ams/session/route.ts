import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimAmsAccessSession } from "@/lib/ams-integration";
import { getUserFromBearer } from "@/lib/auth-role";
import { enforceRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  ticket: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "ams-session", 20, 60 * 60);
  if (rateLimited) return rateLimited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Tiket AMS tidak valid." }, { status: 400, headers: privateHeaders });
  }

  try {
    const session = await claimAmsAccessSession(parsed.data.ticket, request.headers.has("authorization") ? async () => {
      const auth = await getUserFromBearer(request);
      return "user" in auth ? auth.user : null;
    } : undefined);
    if (!session) {
      return NextResponse.json({ success: false, error: "Tiket AMS kedaluwarsa atau sudah digunakan." }, { status: 401, headers: privateHeaders });
    }
    return NextResponse.json({ success: true, ...session }, { headers: privateHeaders });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Gagal menyiapkan sesi APP.",
    }, { status: 500, headers: privateHeaders });
  }
}
