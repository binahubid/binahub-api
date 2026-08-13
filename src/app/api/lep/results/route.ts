import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId) {
    return NextResponse.json({ success: false, error: "programId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();

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
  const { data: responses, error: responsesError } = await db
    .from("lep_responses")
    .select(`
      id, submitted_at,
      q_menyenangkan, q_bermanfaat, q_rekomendasi, q_praktik,
      hal_terpenting, hal_menarik, saran_program,
      lep_speaker_ratings ( speaker_id, score, comment )
    `)
    .eq("program_id", programId)
    .order("submitted_at", { ascending: false });

  if (responsesError) {
    return NextResponse.json({ success: false, error: responsesError.message }, { status: 500 });
  }

  const responseList = (responses || []) as any[];

  // Average scores for 4 common questions
  const avg = (field: string) => {
    const vals = responseList.map((r: any) => r[field]).filter((v: any) => typeof v === "number");
    return vals.length > 0 ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 100) / 100 : null;
  };

  const questionAverages = {
    qMenyenangkan: avg("q_menyenangkan"),
    qBermanfaat: avg("q_bermanfaat"),
    qRekomendasi: avg("q_rekomendasi"),
    qPraktik: avg("q_praktik"),
  };

  // Speaker averages
  const speakerAverages = (speakers || []).map((sp: any) => {
    const ratings: Array<{ score: number; comment?: string }> = [];
    for (const resp of responseList) {
      const sr = (resp.lep_speaker_ratings || []).find((r: any) => r.speaker_id === sp.id);
      if (sr) ratings.push({ score: sr.score, comment: sr.comment });
    }
    const scores = ratings.map((r) => r.score);
    const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;
    return {
      speakerId: sp.id,
      speakerName: sp.name,
      averageScore: avgScore,
      ratingCount: ratings.length,
      comments: ratings.filter((r) => r.comment).map((r) => r.comment!),
    };
  });

  // Open text answers
  const openText = {
    halTerpenting: responseList.map((r: any, i: number) => ({ id: i, text: r.hal_terpenting })),
    halMenarik: responseList.map((r: any, i: number) => ({ id: i, text: r.hal_menarik })),
    saranProgram: responseList
      .map((r: any, i: number) => ({ id: i, text: r.saran_program }))
      .filter((item: { text: any }) => item.text),
  };

  // Response rate via tbos_team_members
  const { data: teamsInProgram } = await db
    .from("tbos_teams")
    .select("id")
    .eq("engagement_id", programId);

  const teamIds = (teamsInProgram || []).map((t: any) => t.id);
  let totalParticipants = 0;
  if (teamIds.length > 0) {
    const { data: memberRows } = await db
      .from("tbos_team_members")
      .select("profile_id")
      .in("team_id", teamIds);
    const distinctProfileIds = new Set((memberRows || []).map((m: any) => m.profile_id).filter(Boolean));
    totalParticipants = distinctProfileIds.size;
  }

  const responseRate = {
    respondents: responseList.length,
    totalParticipants,
    percentage: totalParticipants > 0 ? Math.round((responseList.length / totalParticipants) * 100) : 0,
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
