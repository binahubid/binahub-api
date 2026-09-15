import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { collectAllPages } from "@/lib/pagination";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { createServerSupabase } from "@/lib/supabase";
import { calculateTbosTeamScore, type TbosObservationInput } from "@/lib/tbos-scoring";
import { deriveLiveTimer, liveCoverageIsAligned, rankLiveTeams, type LiveTimerRecord } from "@/lib/tbos-live-score";

const querySchema = z.object({
  programId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
});

const controlSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("configure"),
    programId: z.string().uuid(),
    batchId: z.string().uuid().nullable(),
    title: z.string().trim().min(3).max(80),
    encouragementMessage: z.string().trim().min(3).max(180),
    durationMinutes: z.number().int().min(1).max(240),
    scoresVisible: z.boolean(),
  }).strict(),
  z.object({ action: z.literal("start"), programId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("pause"), programId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("reset"), programId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("finish"), programId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("set_scores_visible"), programId: z.string().uuid(), scoresVisible: z.boolean() }).strict(),
]);

type TeamRow = { id: string; name: string; batch: string; batch_id: string | null };
type ObservationRow = {
  team_id: string;
  mission_id: string;
  status: string;
  submitted_at: string;
  tbos_missions: { code: string } | { code: string }[] | null;
  tbos_observation_scores: Array<{
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | { code: string; name: string }[] | null;
  }>;
};
type MissionDimensionRow = {
  tbos_missions: { code: string } | { code: string }[] | null;
  tbos_behavioral_dimensions: { code: string } | { code: string }[] | null;
};
type SessionRow = LiveTimerRecord & {
  id: string;
  program_id: string;
  batch_id: string | null;
  title: string;
  encouragement_message: string;
  scores_visible: boolean;
  updated_at: string;
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function missingLiveScoreTable(error: { code?: string; message?: string } | null | undefined) {
  return ["42P01", "42703", "PGRST204"].includes(error?.code || "") || Boolean(error?.message?.includes("does not exist"));
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function assertTbosProgram(db: ReturnType<typeof createServerSupabase>, programId: string) {
  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) throw new Error("Modul T-BOS tidak aktif pada program ini.");
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return errorResponse(auth.error || "Akses admin tidak valid.", auth.status || 401);
  const parsed = querySchema.safeParse({
    programId: req.nextUrl.searchParams.get("programId"),
    batchId: req.nextUrl.searchParams.get("batchId") || undefined,
  });
  if (!parsed.success) return errorResponse("programId atau batchId tidak valid.", 400);

  const db = createServerSupabase();
  try { await assertTbosProgram(db, parsed.data.programId); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : "Gagal memeriksa program.", 403); }

  const [programResult, batchResult, sessionResult] = await Promise.all([
    db.from("engagements").select("id,title").eq("id", parsed.data.programId).maybeSingle(),
    db.from("batches").select("id,name,sort_order").eq("program_id", parsed.data.programId).order("sort_order").order("name"),
    db.from("tbos_live_score_sessions").select("id,program_id,batch_id,title,encouragement_message,status,duration_seconds,remaining_seconds,ends_at,scores_visible,updated_at").eq("program_id", parsed.data.programId).maybeSingle(),
  ]);

  if (missingLiveScoreTable(sessionResult.error)) {
    return NextResponse.json({ success: true, liveScoreReady: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const setupError = programResult.error || batchResult.error || sessionResult.error;
  if (setupError) return errorResponse(setupError.message, 500);
  if (!programResult.data) return errorResponse("Program tidak ditemukan.", 404);

  const session = sessionResult.data as SessionRow | null;
  const activeBatchId = session ? session.batch_id : parsed.data.batchId || null;
  if (activeBatchId && !(batchResult.data || []).some((batch) => batch.id === activeBatchId)) {
    return errorResponse("Batch tidak termasuk dalam program ini.", 400);
  }

  const [teams, observations, missionsResult, mappingsResult] = await Promise.all([
    collectAllPages<TeamRow>((from, to) => {
      let query = db.from("tbos_teams").select("id,name,batch,batch_id").eq("engagement_id", parsed.data.programId).order("name");
      if (activeBatchId) query = query.eq("batch_id", activeBatchId);
      return query.range(from, to) as never;
    }),
    collectAllPages<ObservationRow>((from, to) => db.from("tbos_observations").select(`
      team_id, mission_id, status, submitted_at,
      tbos_missions (code),
      tbos_observation_scores (level_value, tbos_behavioral_dimensions (code, name))
    `).eq("program_id", parsed.data.programId).in("status", ["submitted", "locked"]).range(from, to) as never),
    db.from("tbos_missions").select("id,code,name"),
    db.from("tbos_mission_dimensions").select("tbos_missions(code),tbos_behavioral_dimensions(code)"),
  ]).catch((error) => [null, null, null, { error }] as const);

  if (!teams || !observations || !missionsResult || !mappingsResult || missionsResult.error || mappingsResult.error) {
    const message = missionsResult?.error?.message || mappingsResult?.error?.message || (mappingsResult as { error?: Error } | null)?.error?.message || "Data live score tidak dapat dimuat.";
    return errorResponse(message, 500);
  }

  const teamIds = new Set(teams.map((team) => team.id));
  const scopedObservations = observations.filter((observation) => teamIds.has(observation.team_id));
  const missionDimensionMap: Record<string, string[]> = {};
  for (const mapping of (mappingsResult.data || []) as unknown as MissionDimensionRow[]) {
    const missionCode = one(mapping.tbos_missions)?.code;
    const dimensionCode = one(mapping.tbos_behavioral_dimensions)?.code;
    if (!missionCode || !dimensionCode) continue;
    if (!missionDimensionMap[missionCode]) missionDimensionMap[missionCode] = [];
    missionDimensionMap[missionCode].push(dimensionCode);
  }

  const scoreInputs: TbosObservationInput[] = scopedObservations.map((observation) => ({
    teamId: observation.team_id,
    missionCode: one(observation.tbos_missions)?.code || "",
    status: observation.status,
    scores: (observation.tbos_observation_scores || []).map((score) => ({
      dimensionCode: one(score.tbos_behavioral_dimensions)?.code || "",
      dimensionName: one(score.tbos_behavioral_dimensions)?.name || "",
      levelValue: score.level_value,
    })).filter((score) => score.dimensionCode),
  }));

  const candidates = teams.map((team) => {
    const teamRows = scopedObservations.filter((observation) => observation.team_id === team.id);
    const score = calculateTbosTeamScore(team.id, scoreInputs, missionDimensionMap);
    const strongest = [...score.dimensionScores].sort((left, right) => right.score - left.score)[0];
    const latest = teamRows.map((observation) => observation.submitted_at).sort().at(-1) || null;
    return {
      teamId: team.id,
      teamName: team.name,
      batch: team.batch,
      score: score.overallScore,
      completedMissions: new Set(teamRows.map((observation) => observation.mission_id)).size,
      strongestDimension: strongest?.dimensionName || null,
      lastScoredAt: latest,
    };
  });
  const leaderboard = rankLiveTeams(candidates);
  const totalMissions = (missionsResult.data || []).length;
  const totalSlots = teams.length * totalMissions;
  const completedSlots = leaderboard.reduce((total, team) => total + team.completedMissions, 0);
  const now = new Date();
  const defaultTimer: LiveTimerRecord = { status: "ready", duration_seconds: 1200, remaining_seconds: 1200, ends_at: null };
  const timer = deriveLiveTimer(session || defaultTimer, now.getTime());

  if (session?.status === "running" && timer.status === "finished") {
    const { data: elapsedRows, error: elapsedError } = await db
      .from("tbos_live_score_sessions")
      .update({ status: "finished", remaining_seconds: 0, ends_at: null, updated_by: "system:timer" })
      .eq("id", session.id)
      .eq("status", "running")
      .select("id");
    if (!elapsedError && elapsedRows?.length) {
      await db.from("tbos_live_score_audit_log").insert({
        session_id: session.id,
        action: "elapsed",
        actor: "system:timer",
        previous_status: "running",
        new_status: "finished",
      });
    }
  }

  return NextResponse.json({
    success: true,
    liveScoreReady: true,
    serverTime: now.toISOString(),
    program: programResult.data,
    batches: batchResult.data || [],
    activeBatchId,
    activeBatchName: (batchResult.data || []).find((batch) => batch.id === activeBatchId)?.name || "Semua batch",
    session: {
      configured: Boolean(session),
      id: session?.id || null,
      title: session?.title || "T-BOS Live Score",
      encouragementMessage: session?.encouragement_message || "Tetap kompak. Setiap misi adalah kesempatan untuk naik bersama.",
      status: timer.status,
      durationSeconds: session?.duration_seconds || 1200,
      remainingSeconds: timer.remainingSeconds,
      endsAt: timer.status === "running" ? session?.ends_at || null : null,
      scoresVisible: session?.scores_visible ?? true,
      updatedAt: session?.updated_at || null,
    },
    summary: {
      teamCount: teams.length,
      scoredTeamCount: leaderboard.filter((team) => team.score !== null).length,
      completedMissionSlots: completedSlots,
      totalMissionSlots: totalSlots,
      completionPercent: totalSlots ? Math.round((completedSlots / totalSlots) * 100) : 0,
      coverageAligned: liveCoverageIsAligned(leaderboard),
      rankingStatus: liveCoverageIsAligned(leaderboard) ? "comparable" : "provisional",
    },
    leaderboard,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return errorResponse(auth.error || "Akses admin tidak valid.", auth.status || 401);
  const body = await req.json().catch(() => null);
  const parsed = controlSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Kontrol live score tidak valid.", 400);

  const db = createServerSupabase();
  try { await assertTbosProgram(db, parsed.data.programId); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : "Gagal memeriksa program.", 403); }

  const { data: existingData, error: existingError } = await db.from("tbos_live_score_sessions").select("*").eq("program_id", parsed.data.programId).maybeSingle();
  if (missingLiveScoreTable(existingError)) return errorResponse("Terapkan migrasi 0051 sebelum menggunakan Live Score.", 409);
  if (existingError) return errorResponse(existingError.message, 500);
  const existing = existingData as SessionRow | null;

  if (parsed.data.action === "configure") {
    if (existing?.status === "running") return errorResponse("Jeda atau selesaikan countdown sebelum mengubah konfigurasi.", 409);
    if (parsed.data.batchId) {
      const { data: batch, error } = await db.from("batches").select("id").eq("id", parsed.data.batchId).eq("program_id", parsed.data.programId).maybeSingle();
      if (error) return errorResponse(error.message, 500);
      if (!batch) return errorResponse("Batch tidak termasuk dalam program ini.", 400);
    }
    const durationSeconds = parsed.data.durationMinutes * 60;
    const { data: saved, error } = await db.from("tbos_live_score_sessions").upsert({
      program_id: parsed.data.programId,
      batch_id: parsed.data.batchId,
      title: parsed.data.title,
      encouragement_message: parsed.data.encouragementMessage,
      status: "ready",
      duration_seconds: durationSeconds,
      remaining_seconds: durationSeconds,
      ends_at: null,
      scores_visible: parsed.data.scoresVisible,
      updated_by: auth.email,
    }, { onConflict: "program_id" }).select("*").single();
    if (error || !saved) return errorResponse(error?.message || "Konfigurasi tidak dapat disimpan.", 500);
    await db.from("tbos_live_score_audit_log").insert({ session_id: saved.id, action: "configured", actor: auth.email, previous_status: existing?.status || null, new_status: "ready", metadata: { batchId: parsed.data.batchId, durationSeconds, scoresVisible: parsed.data.scoresVisible } });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!existing) return errorResponse("Simpan konfigurasi live score terlebih dahulu.", 409);
  const now = new Date();
  const current = deriveLiveTimer(existing, now.getTime());
  let update: Record<string, unknown>;
  let auditAction: "started" | "paused" | "reset" | "finished" | "scores_shown" | "scores_hidden";

  if (parsed.data.action === "start") {
    if (existing.status === "running" && current.status === "running") return errorResponse("Countdown sudah berjalan.", 409);
    const remainingSeconds = current.remainingSeconds > 0 ? current.remainingSeconds : existing.duration_seconds;
    update = { status: "running", remaining_seconds: remainingSeconds, ends_at: new Date(now.getTime() + remainingSeconds * 1000).toISOString(), updated_by: auth.email };
    auditAction = "started";
  } else if (parsed.data.action === "pause") {
    if (existing.status !== "running" || current.status !== "running") return errorResponse("Countdown tidak sedang berjalan.", 409);
    update = { status: "paused", remaining_seconds: current.remainingSeconds, ends_at: null, updated_by: auth.email };
    auditAction = "paused";
  } else if (parsed.data.action === "reset") {
    update = { status: "ready", remaining_seconds: existing.duration_seconds, ends_at: null, updated_by: auth.email };
    auditAction = "reset";
  } else if (parsed.data.action === "finish") {
    update = { status: "finished", remaining_seconds: 0, ends_at: null, updated_by: auth.email };
    auditAction = "finished";
  } else {
    update = { scores_visible: parsed.data.scoresVisible, updated_by: auth.email };
    auditAction = parsed.data.scoresVisible ? "scores_shown" : "scores_hidden";
  }

  const { error } = await db.from("tbos_live_score_sessions").update(update).eq("id", existing.id);
  if (error) return errorResponse(error.message, 500);
  await db.from("tbos_live_score_audit_log").insert({
    session_id: existing.id,
    action: auditAction,
    actor: auth.email,
    previous_status: existing.status,
    new_status: typeof update.status === "string" ? update.status : existing.status,
    metadata: { remainingSeconds: update.remaining_seconds ?? current.remainingSeconds },
  });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
