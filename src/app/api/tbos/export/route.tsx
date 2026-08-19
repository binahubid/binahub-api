import { renderToBuffer } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { collectAllPages } from "@/lib/pagination";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { createServerSupabase } from "@/lib/supabase";
import {
  buildTbosProgramReport,
  type TbosProgramReport,
  type TbosReportObservationInput,
  type TbosReportTeamInput,
} from "@/lib/tbos-report-data";
import { TbosGroupReportDocument, TbosTeamReportDocument } from "@/lib/tbos-report-document";

interface ProgramRow {
  id: string;
  code: string | null;
  title: string;
  start_date: string | null;
  end_date: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  batch: string;
  engagement_id: string | null;
}

interface MemberRow {
  team_id: string;
  member_name: string;
  is_captain: boolean;
}

interface ObservationRow {
  id: string;
  team_id: string;
  program_id: string;
  observed_at: string;
  submitted_at: string;
  status: string;
  notes: string | null;
  tbos_missions: { code: string; name: string } | null;
  profiles: { full_name: string } | null;
  tbos_observation_scores: Array<{
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | null;
  }>;
}

type Db = ReturnType<typeof createServerSupabase>;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const format = (req.nextUrl.searchParams.get("format") || "csv").toLowerCase();
  const requestedProgramId = req.nextUrl.searchParams.get("programId");
  const teamId = req.nextUrl.searchParams.get("teamId");
  const batch = req.nextUrl.searchParams.get("batch");
  if (!requestedProgramId && !teamId) {
    return NextResponse.json({ success: false, error: "programId atau teamId wajib diisi." }, { status: 400 });
  }
  if (!z.enum(["csv", "pdf"]).safeParse(format).success
    || (requestedProgramId && !z.string().uuid().safeParse(requestedProgramId).success)
    || (teamId && !z.string().uuid().safeParse(teamId).success)
    || (batch !== null && (batch.length < 1 || batch.length > 120))) {
    return NextResponse.json({ success: false, error: "Parameter ekspor tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  let programId = requestedProgramId;
  if (teamId) {
    const { data: team, error: teamError } = await db
      .from("tbos_teams")
      .select("id, engagement_id")
      .eq("id", teamId)
      .maybeSingle();
    if (teamError) {
      return NextResponse.json({ success: false, error: "Gagal memeriksa tim." }, { status: 500 });
    }
    if (!team?.engagement_id) {
      return NextResponse.json({ success: false, error: "Tim tidak ditemukan atau belum terhubung ke program." }, { status: 404 });
    }
    if (programId && programId !== team.engagement_id) {
      return NextResponse.json({ success: false, error: "Tim tidak termasuk dalam program yang dipilih." }, { status: 400 });
    }
    programId = team.engagement_id;
  }

  if (!programId) {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }

  try {
    if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
      return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif untuk program ini." }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  try {
    const report = await fetchProgramReport(db, programId, batch);
    const selectedTeam = teamId ? report.teams.find((team) => team.id === teamId) ?? null : null;
    if (teamId && !selectedTeam) {
      return NextResponse.json({ success: false, error: "Tim tidak ditemukan pada laporan program." }, { status: 404 });
    }
    if (batch && report.teams.length === 0) {
      return NextResponse.json({ success: false, error: "Batch tidak ditemukan pada program ini." }, { status: 404 });
    }

    if (format === "csv") {
      const csv = buildCsv(report, teamId || null);
      const filename = teamId && selectedTeam
        ? `tbos_tim_${safeFilename(selectedTeam.name)}_${isoDate()}.csv`
        : batch
          ? `tbos_batch_${safeFilename(batch)}_${isoDate()}.csv`
          : `tbos_program_${safeFilename(report.program.code)}_${isoDate()}.csv`;
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const buffer = await renderReportPdf(report, selectedTeam, batch);
    const filename = selectedTeam
      ? `tbos_laporan_tim_${safeFilename(selectedTeam.name)}_${isoDate()}.pdf`
      : batch
        ? `tbos_laporan_batch_${safeFilename(batch)}_${isoDate()}.pdf`
        : `tbos_laporan_grup_${safeFilename(report.program.code)}_${isoDate()}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[T-BOS Export] Failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal membuat laporan T-BOS." },
      { status: 500 },
    );
  }
}

function renderReportPdf(
  report: TbosProgramReport,
  selectedTeam: TbosProgramReport["teams"][number] | null,
  batch: string | null = null,
) {
  const document = selectedTeam
    ? <TbosTeamReportDocument report={report} team={selectedTeam} />
    : <TbosGroupReportDocument report={report} batch={batch ?? undefined} />;
  return renderToBuffer(document);
}

async function fetchProgramReport(db: Db, programId: string, batch: string | null = null): Promise<TbosProgramReport> {
  const { data: programRow, error: programError } = await db
    .from("engagements")
    .select("id, code, title, start_date, end_date")
    .eq("id", programId)
    .maybeSingle();
  if (programError) throw new Error(`Gagal memuat program: ${programError.message}`);
  if (!programRow) throw new Error("Program tidak ditemukan.");

  const teams = await collectAllPages<TeamRow>((from, to) => db
    .from("tbos_teams")
    .select("id, name, batch, engagement_id")
    .eq("engagement_id", programId)
    .order("name", { ascending: true })
    .range(from, to) as never);
  const scopedTeams = batch ? teams.filter((team) => team.batch === batch) : teams;
  const teamIds = scopedTeams.map((team) => team.id);

  let members: MemberRow[] = [];
  if (teamIds.length > 0) {
    members = await collectAllPages<MemberRow>((from, to) => db
      .from("tbos_team_members")
      .select("team_id, member_name, is_captain")
      .in("team_id", teamIds)
      .order("is_captain", { ascending: false })
      .order("member_name", { ascending: true })
      .range(from, to) as never);
  }

  const observationRows = await collectAllPages<ObservationRow>((from, to) => db
    .from("tbos_observations")
    .select(`
      id,
      team_id,
      program_id,
      observed_at,
      submitted_at,
      status,
      notes,
      tbos_missions (code, name),
      profiles!tbos_observations_profile_id_fkey (full_name),
      tbos_observation_scores (
        level_value,
        tbos_behavioral_dimensions (code, name)
      )
    `)
    .eq("program_id", programId)
    .in("status", ["submitted", "locked"])
    .order("submitted_at", { ascending: true })
    .range(from, to) as never);

  const membersByTeam = new Map<string, TbosReportTeamInput["members"]>();
  for (const member of members) {
    const current = membersByTeam.get(member.team_id) || [];
    current.push({ name: member.member_name, isCaptain: member.is_captain });
    membersByTeam.set(member.team_id, current);
  }

  const teamInputs: TbosReportTeamInput[] = scopedTeams.map((team) => ({
    id: team.id,
    name: team.name,
    batch: team.batch,
    members: membersByTeam.get(team.id) || [],
  }));
  const observations: TbosReportObservationInput[] = observationRows.map((observation) => ({
    id: observation.id,
    teamId: observation.team_id,
    missionCode: observation.tbos_missions?.code || "unknown",
    missionName: observation.tbos_missions?.name || "Misi tidak diketahui",
    facilitatorName: observation.profiles?.full_name || "-",
    observedAt: observation.observed_at,
    submittedAt: observation.submitted_at,
    status: observation.status,
    notes: observation.notes,
    scores: (observation.tbos_observation_scores || []).map((score) => ({
      dimensionCode: score.tbos_behavioral_dimensions?.code || "unknown",
      dimensionName: score.tbos_behavioral_dimensions?.name || "Dimensi tidak diketahui",
      levelValue: score.level_value,
    })),
  }));

  const program = programRow as ProgramRow;
  return buildTbosProgramReport({
    program: {
      id: program.id,
      code: program.code || "TANPA-KODE",
      title: program.title,
      startDate: program.start_date,
      endDate: program.end_date,
    },
    teams: teamInputs,
    observations: batch
      ? observations.filter((observation) => teamIds.includes(observation.teamId))
      : observations,
  });
}

function buildCsv(report: TbosProgramReport, teamId: string | null) {
  const observations = report.teams
    .filter((team) => !teamId || team.id === teamId)
    .flatMap((team) => team.observations.map((observation) => ({ team, observation })));
  const rows = [
    ["Tim", "Batch", "Misi", "Fasilitator", "Tanggal Observasi", "Status", "Dimensi", "Nilai", "Level", "Catatan"],
  ];
  for (const { team, observation } of observations) {
    if (observation.scores.length === 0) {
      rows.push([team.name, team.batch, observation.missionName, observation.facilitatorName, observation.observedAt, statusLabel(observation.status), "", "", "", observation.notes || ""]);
      continue;
    }
    for (const score of observation.scores) {
      rows.push([
        team.name,
        team.batch,
        observation.missionName,
        observation.facilitatorName,
        observation.observedAt,
        statusLabel(observation.status),
        score.dimensionName,
        String(score.levelValue),
        levelLabel(score.levelValue),
        observation.notes || "",
      ]);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function levelLabel(value: number) {
  return ["", "Reactive", "Emerging", "Functional", "Effective", "Exemplary"][value] || "";
}

function statusLabel(status: string) {
  if (status === "locked") return "Terkunci";
  if (status === "submitted") return "Tersimpan";
  return "Draf";
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "tbos";
}

function isoDate() {
  return new Date().toISOString().split("T")[0];
}
