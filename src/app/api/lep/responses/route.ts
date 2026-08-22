import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requirePeserta } from "@/lib/peserta-auth";
import { isParticipantInProgram, isProgramAccessible, isProgramModuleEnabled } from "@/lib/program-access";

const responseSchema = z.object({
  programId: z.string().uuid(),
  qMenyenangkan: z.number().int().min(1).max(4),
  qBermanfaat: z.number().int().min(1).max(4),
  qRekomendasi: z.number().int().min(1).max(4),
  qPraktik: z.number().int().min(1).max(4),
  halTerpenting: z.string().trim().min(1).max(4000),
  halMenarik: z.string().trim().min(1).max(4000),
  saranProgram: z.string().trim().max(4000).optional().default(""),
  speakerRatings: z.array(z.object({
    speakerId: z.string().uuid(),
    score: z.number().int().min(1).max(4),
    comment: z.string().trim().max(2000).optional().default(""),
  })),
});

async function requireLepParticipantAccess(userId: string, programId: string) {
  const db = createServerSupabase();
  const [accessible, enabled, member] = await Promise.all([
    isProgramAccessible(db, programId),
    isProgramModuleEnabled(db, programId, "lep"),
    isParticipantInProgram(db, userId, programId),
  ]);
  return { db, accessible, enabled, member };
}

export async function GET(req: NextRequest) {
  const auth = await requirePeserta(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }

  try {
    const { db, accessible, enabled, member } = await requireLepParticipantAccess(auth.userId, programId);
    if (!accessible) return NextResponse.json({ success: false, error: "Program tidak sedang aktif." }, { status: 403 });
    if (!enabled) return NextResponse.json({ success: false, error: "Modul LEP tidak aktif." }, { status: 403 });
    if (!member) return NextResponse.json({ success: false, error: "Anda tidak terdaftar pada program ini." }, { status: 403 });

    const { data, error } = await db
      .from("lep_responses")
      .select("id, submitted_at")
      .eq("program_id", programId)
      .eq("profile_id", auth.userId)
      .maybeSingle();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, response: data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa evaluasi." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePeserta(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = responseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Field wajib belum lengkap." }, { status: 400 });
  }

  const input = parsed.data;

  try {
    const { db, accessible, enabled, member } = await requireLepParticipantAccess(auth.userId, input.programId);
    if (!accessible) return NextResponse.json({ success: false, error: "Masa akses program telah berakhir." }, { status: 403 });
    if (!enabled) return NextResponse.json({ success: false, error: "Modul LEP tidak aktif." }, { status: 403 });
    if (!member) return NextResponse.json({ success: false, error: "Anda tidak terdaftar pada program ini." }, { status: 403 });

    const { data: speakers, error: speakerError } = await db
      .from("lep_speakers")
      .select("id")
      .eq("program_id", input.programId)
      .is("deleted_at", null);
    if (speakerError) return NextResponse.json({ success: false, error: speakerError.message }, { status: 500 });

    const expectedSpeakerIds = new Set((speakers || []).map((speaker) => speaker.id));
    const submittedSpeakerIds = input.speakerRatings.map((rating) => rating.speakerId);
    if (
      submittedSpeakerIds.length !== expectedSpeakerIds.size
      || new Set(submittedSpeakerIds).size !== submittedSpeakerIds.length
      || submittedSpeakerIds.some((id) => !expectedSpeakerIds.has(id))
    ) {
      return NextResponse.json({ success: false, error: "Rating seluruh pemateri program wajib diisi tepat satu kali." }, { status: 400 });
    }

    const { data: responseId, error } = await db.rpc("submit_lep_response", {
      p_program_id: input.programId,
      p_profile_id: auth.userId,
      p_q_menyenangkan: input.qMenyenangkan,
      p_q_bermanfaat: input.qBermanfaat,
      p_q_rekomendasi: input.qRekomendasi,
      p_q_praktik: input.qPraktik,
      p_hal_terpenting: input.halTerpenting,
      p_hal_menarik: input.halMenarik,
      p_saran_program: input.saranProgram || null,
      p_speaker_ratings: input.speakerRatings,
    });

    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { success: false, error: duplicate ? "Anda sudah mengisi evaluasi untuk program ini." : error.message },
        { status: duplicate ? 409 : error.code === "42501" ? 403 : 400 },
      );
    }

    return NextResponse.json({ success: true, responseId });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal menyimpan evaluasi." }, { status: 500 });
  }
}
