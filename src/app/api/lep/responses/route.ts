import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requirePeserta } from "@/lib/peserta-auth";

export async function GET(req: NextRequest) {
  const auth = await requirePeserta(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId) {
    return NextResponse.json({ success: false, error: "programId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("lep_responses")
    .select("id, submitted_at")
    .eq("program_id", programId)
    .eq("profile_id", auth.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, response: data });
}

export async function POST(req: NextRequest) {
  const auth = await requirePeserta(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const {
    programId,
    qMenyenangkan,
    qBermanfaat,
    qRekomendasi,
    qPraktik,
    halTerpenting,
    halMenarik,
    saranProgram,
    speakerRatings,
  } = body as {
    programId?: string;
    qMenyenangkan?: number;
    qBermanfaat?: number;
    qRekomendasi?: number;
    qPraktik?: number;
    halTerpenting?: string;
    halMenarik?: string;
    saranProgram?: string;
    speakerRatings?: Array<{ speakerId: string; score: number; comment?: string }>;
  };

  if (!programId || !qMenyenangkan || !qBermanfaat || !qRekomendasi || !qPraktik
      || !halTerpenting || !halTerpenting.trim() || !halMenarik || !halMenarik.trim()) {
    return NextResponse.json({ success: false, error: "Field wajib belum lengkap." }, { status: 400 });
  }

  for (const [field, value] of [["qMenyenangkan", qMenyenangkan], ["qBermanfaat", qBermanfaat], ["qRekomendasi", qRekomendasi], ["qPraktik", qPraktik]] as const) {
    if (typeof value !== "number" || value < 1 || value > 4) {
      return NextResponse.json({ success: false, error: `${field} harus antara 1 dan 4.` }, { status: 400 });
    }
  }

  const db = createServerSupabase();

  // Check if already submitted (unique constraint)
  const { data: existing } = await db
    .from("lep_responses")
    .select("id")
    .eq("program_id", programId)
    .eq("profile_id", auth.userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ success: false, error: "Anda sudah mengisi evaluasi untuk program ini." }, { status: 409 });
  }

  // Insert response
  const { data: responseRow, error: responseError } = await db
    .from("lep_responses")
    .insert({
      program_id: programId,
      profile_id: auth.userId,
      q_menyenangkan: qMenyenangkan,
      q_bermanfaat: qBermanfaat,
      q_rekomendasi: qRekomendasi,
      q_praktik: qPraktik,
      hal_terpenting: halTerpenting.trim(),
      hal_menarik: halMenarik.trim(),
      saran_program: saranProgram?.trim() || null,
    })
    .select("id")
    .single();

  if (responseError) {
    if (responseError.code === "23505") {
      return NextResponse.json({ success: false, error: "Anda sudah mengisi evaluasi untuk program ini." }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: responseError.message }, { status: 500 });
  }

  // Insert speaker ratings
  if (speakerRatings && speakerRatings.length > 0) {
    const ratingRows = speakerRatings.map((r) => ({
      response_id: responseRow.id,
      speaker_id: r.speakerId,
      score: r.score,
      comment: r.comment?.trim() || null,
    }));

    const { error: ratingError } = await db
      .from("lep_speaker_ratings")
      .insert(ratingRows);

    if (ratingError) {
      console.error("[LEP] speaker ratings insert error:", ratingError);
    }
  }

  return NextResponse.json({ success: true, responseId: responseRow.id });
}
