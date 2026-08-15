import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { z } from "zod";
import { collectAllPages } from "@/lib/pagination";
import { isProgramModuleEnabled } from "@/lib/program-access";

interface SpeakerRow {
  id: string;
  name: string;
  sort_order: number;
}

interface SpeakerRatingRow {
  speaker_id: string;
  score: number;
  comment: string | null;
}

interface LepResponseRow {
  id: string;
  submitted_at: string;
  q_menyenangkan: number;
  q_bermanfaat: number;
  q_rekomendasi: number;
  q_praktik: number;
  hal_terpenting: string;
  hal_menarik: string;
  saran_program: string | null;
  lep_speaker_ratings: SpeakerRatingRow[];
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  try {
    if (!(await isProgramModuleEnabled(db, programId, "lep"))) {
      return NextResponse.json({ success: false, error: "Modul LEP tidak aktif." }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  // Fetch speakers
  const { data: speakers, error: speakersError } = await db
    .from("lep_speakers")
    .select("id, name, sort_order")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true });

  if (speakersError) {
    return NextResponse.json({ success: false, error: speakersError.message }, { status: 500 });
  }

  // Fetch responses
  let responseList: LepResponseRow[];
  try {
    responseList = await collectAllPages<LepResponseRow>((from, to) => db
      .from("lep_responses")
      .select(`
      id, submitted_at,
      q_menyenangkan, q_bermanfaat, q_rekomendasi, q_praktik,
      hal_terpenting, hal_menarik, saran_program,
      lep_speaker_ratings ( speaker_id, score, comment )
    `)
      .eq("program_id", programId)
      .order("submitted_at", { ascending: false })
      .range(from, to) as never);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat respons LEP." }, { status: 500 });
  }

  // Average scores for 4 common questions
  const avg = (field: keyof Pick<LepResponseRow, "q_menyenangkan" | "q_bermanfaat" | "q_rekomendasi" | "q_praktik">) => {
    const vals = responseList.map((response) => response[field]);
    return vals.length > 0 ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 100) / 100 : null;
  };

  const questionAverages = {
    qMenyenangkan: avg("q_menyenangkan"),
    qBermanfaat: avg("q_bermanfaat"),
    qRekomendasi: avg("q_rekomendasi"),
    qPraktik: avg("q_praktik"),
  };

  // Speaker averages
  const speakerAverages = ((speakers || []) as SpeakerRow[]).map((speaker) => {
    const ratings: Array<{ score: number; comment?: string }> = [];
    for (const response of responseList) {
      const rating = response.lep_speaker_ratings.find((item) => item.speaker_id === speaker.id);
      if (rating) ratings.push({ score: rating.score, comment: rating.comment || undefined });
    }
    const scores = ratings.map((r) => r.score);
    const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
    return {
      speakerId: speaker.id,
      speakerName: speaker.name,
      averageScore: avgScore,
      ratingCount: ratings.length,
      comments: ratings.filter((r) => r.comment).map((r) => r.comment!),
    };
  });

  // Open text answers
  const openText = {
    halTerpenting: responseList.map((response, index) => ({ id: index, text: response.hal_terpenting })),
    halMenarik: responseList.map((response, index) => ({ id: index, text: response.hal_menarik })),
    saranProgram: responseList
      .map((response, index) => ({ id: index, text: response.saran_program }))
      .filter((item): item is { id: number; text: string } => Boolean(item.text)),
  };

  const { count: totalParticipants, error: participantCountError } = await db
    .from("engagement_participants")
    .select("id", { count: "exact", head: true })
    .eq("engagement_id", programId);
  if (participantCountError) {
    return NextResponse.json({ success: false, error: participantCountError.message }, { status: 500 });
  }

  const responseRate = {
    respondents: responseList.length,
    totalParticipants: totalParticipants || 0,
    percentage: (totalParticipants || 0) > 0 ? Math.min(100, Math.round((responseList.length / (totalParticipants || 1)) * 100)) : 0,
  };

  return NextResponse.json({
    success: true,
    speakers: speakers || [],
    questionAverages,
    speakerAverages,
    openText,
    responseRate,
    totalResponses: responseList.length,
  });
}
