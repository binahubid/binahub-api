import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Polygon, Line, Circle } from "@react-pdf/renderer";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { z } from "zod";
import { collectAllPages } from "@/lib/pagination";

interface TeamDimensionScore {
  code: string;
  name: string;
  score: number | null;
}

interface ExportObservation {
  id: string;
  team_id: string;
  batch: string;
  observed_at: string;
  submitted_at: string;
  status: string;
  notes: string | null;
  tbos_teams: { name: string } | null;
  tbos_missions: { code: string; name: string } | null;
  profiles: { full_name: string } | null;
  tbos_observation_scores: Array<{
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | null;
  }>;
}

function radarPoints(values: number[], radius: number, center: number) {
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / values.length;
    const scaled = radius * (value / 5);
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  }).join(" ");
}

function TeamRadar({ dimensions }: { dimensions: TeamDimensionScore[] }) {
  const size = 180;
  const center = size / 2;
  const radius = 72;
  const values = dimensions.map((dimension) => dimension.score || 0);
  return (
    <View style={{ alignItems: "center", marginVertical: 8 }}>
      <Svg width={size} height={size}>
        {[1, 2, 3, 4, 5].map((level) => (
          <Polygon key={level} points={radarPoints(dimensions.map(() => level), radius, center)} fill="none" stroke="#CBD5E1" strokeWidth={0.7} />
        ))}
        {dimensions.map((dimension, index) => {
          const endpoint = radarPoints(dimensions.map((_, pointIndex) => pointIndex === index ? 5 : 0), radius, center).split(" ")[index].split(",");
          return <Line key={dimension.code} x1={center} y1={center} x2={Number(endpoint[0])} y2={Number(endpoint[1])} stroke="#CBD5E1" strokeWidth={0.7} />;
        })}
        <Polygon points={radarPoints(values, radius, center)} fill="#D9A441" fillOpacity={0.28} stroke="#0B2C6B" strokeWidth={1.5} />
        <Circle cx={center} cy={center} r={2} fill="#0B2C6B" />
      </Svg>
    </View>
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "csv";
  const programId = url.searchParams.get("programId");
  const teamId = url.searchParams.get("teamId");

  const db = createServerSupabase();

  if (!programId && !teamId) {
    return NextResponse.json({ success: false, error: "programId atau teamId wajib diisi." }, { status: 400 });
  }
  if ((programId && !z.string().uuid().safeParse(programId).success)
    || (teamId && !z.string().uuid().safeParse(teamId).success)
    || !["csv", "pdf"].includes(format)) {
    return NextResponse.json({ success: false, error: "Parameter export tidak valid." }, { status: 400 });
  }

  if (programId) {
    try {
      if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
        return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
      }
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
    }
  }

  if (teamId && format === "pdf") {
    return handleTeamReport(db, teamId);
  }

  let observations: ExportObservation[];
  try {
    observations = await collectAllPages<ExportObservation>((from, to) => {
      let query = db.from("tbos_observations").select(`
       id,
       team_id,
      batch,
      observed_at,
      submitted_at,
      status,
      notes,
      tbos_teams (name),
      tbos_missions (code, name),
      profiles (full_name),
      tbos_observation_scores (
        level_value,
        tbos_behavioral_dimensions (code, name)
      )
      `)
        .in("status", ["submitted", "locked"])
        .order("submitted_at", { ascending: false });
      if (programId) query = query.eq("program_id", programId);
      return query.range(from, to) as never;
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat data export." }, { status: 500 });
  }

  if (format === "csv") {
    const rows: string[] = [];
    const typedObservations = observations;

    rows.push("Team,Mission,Batch,Facilitator,Observed At,Submitted At,Status,Dimension,Level Value,Level Label,Notes");

    for (const obs of typedObservations) {
      const teamName = obs.tbos_teams?.name || "";
      const missionName = obs.tbos_missions?.name || "";
      const facilitatorName = obs.profiles?.full_name || "";
      const scores = obs.tbos_observation_scores || [];

      if (scores.length === 0) {
        rows.push([
          escapeCsv(teamName),
          escapeCsv(missionName),
          escapeCsv(obs.batch),
          escapeCsv(facilitatorName),
          obs.observed_at,
          obs.submitted_at,
          obs.status,
          "", "", "", "",
          escapeCsv(obs.notes || ""),
        ].join(","));
      } else {
        for (const score of scores) {
          const dimName = score.tbos_behavioral_dimensions?.name || "";
          const levelLabel = ["", "Reactive", "Emerging", "Functional", "Effective", "Exemplary"][score.level_value] || "";
          rows.push([
            escapeCsv(teamName),
            escapeCsv(missionName),
            escapeCsv(obs.batch),
            escapeCsv(facilitatorName),
            obs.observed_at,
            obs.submitted_at,
            obs.status,
            escapeCsv(dimName),
            score.level_value,
            escapeCsv(levelLabel),
            escapeCsv(obs.notes || ""),
          ].join(","));
        }
      }
    }

    const csv = "\uFEFF" + rows.join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tbos_observations_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  if (format === "pdf") {
    const styles = StyleSheet.create({
      page: { padding: 36, fontSize: 10, color: "#1E293B" },
      title: { fontSize: 20, color: "#0B2C6B", marginBottom: 4 },
      meta: { fontSize: 9, color: "#64748B", marginBottom: 18 },
      section: { marginBottom: 14 },
      heading: { fontSize: 12, color: "#0B2C6B", marginBottom: 6 },
      row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingVertical: 5 },
      cell: { flex: 1, fontSize: 8 },
      header: { backgroundColor: "#0B2C6B", color: "#FFFFFF", padding: 6 },
    });
    const rows = observations;
    const document = (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text style={styles.title}>T-BOS Report</Text>
          <Text style={styles.meta}>Generated {new Date().toLocaleDateString("id-ID")} · {rows.length} observasi</Text>
          <View style={styles.section}>
            <Text style={styles.heading}>Ringkasan Observasi</Text>
            <View style={[styles.row, styles.header]}><Text style={styles.cell}>Tim</Text><Text style={styles.cell}>Mission</Text><Text style={styles.cell}>Batch</Text><Text style={styles.cell}>Status</Text></View>
            {rows.map((obs) => (
              <View key={obs.id} style={styles.row}>
                <Text style={styles.cell}>{obs.tbos_teams?.name || "-"}</Text>
                <Text style={styles.cell}>{obs.tbos_missions?.name || "-"}</Text>
                <Text style={styles.cell}>{obs.batch}</Text>
                <Text style={styles.cell}>{obs.status}</Text>
              </View>
            ))}
          </View>
        </Page>
      </Document>
    );
    const buffer = await renderToBuffer(document);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tbos_report_${new Date().toISOString().split("T")[0]}.pdf"`,
      },
    });
  }

  return NextResponse.json({ success: false, error: "Format tidak didukung." }, { status: 400 });
}

function escapeCsv(value: string): string {
  if (!value) return "";
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (safeValue.includes(",") || safeValue.includes('"') || safeValue.includes("\n")) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

interface TeamReportRow {
  team: {
    name: string;
    batch: string;
    engagement_id: string | null;
    batches?: { name: string } | null;
  } | null;
  members: Array<{ member_name: string; is_captain: boolean }>;
  observations: Array<{
    mission: string;
    missionCode: string;
    observedAt: string;
    submittedAt: string;
    status: string;
    facilitator: string;
    scores: Array<{ dimension: string; dimensionCode: string; levelValue: number }>;
    notes: string | null;
  }>;
}

interface TeamReportObservationRow {
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

async function handleTeamReport(db: ReturnType<typeof createServerSupabase>, teamId: string) {
  const { data: teamRow, error: teamError } = await db
    .from("tbos_teams")
    .select("id, name, batch, engagement_id, batches ( name )")
    .eq("id", teamId)
    .single();

  if (teamError || !teamRow) {
    return NextResponse.json({ success: false, error: teamError?.message || "Tim tidak ditemukan." }, { status: teamError ? 500 : 404 });
  }

  if (!teamRow.engagement_id) {
    return NextResponse.json({ success: false, error: "Tim belum terhubung ke program." }, { status: 409 });
  }
  try {
    if (!(await isProgramModuleEnabled(db, teamRow.engagement_id, "tbos"))) {
      return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  const { data: memberRows, error: membersError } = await db
    .from("tbos_team_members")
    .select("member_name, is_captain")
    .eq("team_id", teamId)
    .order("is_captain", { ascending: false });

  if (membersError) {
    return NextResponse.json({ success: false, error: membersError.message }, { status: 500 });
  }

  const { data: obsRows, error: obsError } = await db
    .from("tbos_observations")
    .select(`
      id,
      observed_at,
      submitted_at,
      status,
      notes,
      tbos_missions ( code, name ),
      profiles ( full_name ),
      tbos_observation_scores (
        level_value,
        tbos_behavioral_dimensions ( code, name )
      )
    `)
    .eq("team_id", teamId)
    .in("status", ["submitted", "locked"])
    .order("submitted_at", { ascending: false });

  if (obsError) {
    return NextResponse.json({ success: false, error: obsError.message }, { status: 500 });
  }

  const observations = ((obsRows || []) as unknown as TeamReportObservationRow[]).map((obs) => ({
    mission: obs.tbos_missions?.name || "-",
    missionCode: obs.tbos_missions?.code || "",
    observedAt: obs.observed_at,
    submittedAt: obs.submitted_at,
    status: obs.status,
    facilitator: obs.profiles?.full_name || "-",
    scores: (obs.tbos_observation_scores || []).map((s) => ({
      dimension: s.tbos_behavioral_dimensions?.name || "",
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      levelValue: s.level_value,
    })),
    notes: obs.notes,
  }));

  const row: TeamReportRow = {
    team: teamRow as unknown as TeamReportRow["team"],
    members: (memberRows || []) as TeamReportRow["members"],
    observations,
  };

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 10, color: "#1E293B" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 12, marginBottom: 18, borderBottomWidth: 3, borderBottomColor: "#D9A441" },
    logo: { fontSize: 18, fontWeight: 700, color: "#0B2C6B" },
    logoAccent: { color: "#D9A441" },
    title: { fontSize: 13, fontWeight: 700, color: "#0B2C6B" },
    section: { marginBottom: 14 },
    sectionTitle: { fontSize: 11, fontWeight: 700, color: "#0B2C6B", marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingBottom: 3 },
    badge: { fontSize: 9, color: "#64748B", marginBottom: 12 },
    row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
    headerRow: { backgroundColor: "#0B2C6B", borderRadius: 4, paddingVertical: 5, paddingHorizontal: 4 },
    headerCell: { fontSize: 8, fontWeight: 700, color: "#FFFFFF" },
    cell: { fontSize: 8 },
    dimRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
    dimName: { flex: 1, fontSize: 9, fontWeight: 600 },
    dimScore: { fontSize: 9, fontWeight: 700, color: "#0B2C6B" },
    memberPill: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
    captainMark: { fontSize: 8, color: "#D9A441", fontWeight: 700, marginRight: 6 },
    noteBox: { marginTop: 2, fontSize: 8, color: "#64748B", fontStyle: "italic" },
  });

  const team = row.team!;
  const batchName = Array.isArray(team.batches) ? team.batches[0]?.name : (team.batches as unknown as { name: string } | null)?.name;
  const batchLabel = batchName || team.batch || "-";

  const allDimCodes = [
    ["goal_alignment", "Goal Alignment"],
    ["communication", "Communication"],
    ["data_based_decision", "Data-Based Decision Making"],
    ["execution_discipline", "Execution Discipline"],
    ["accountability", "Accountability"],
    ["adaptability", "Adaptability"],
    ["collaboration", "Collaboration"],
    ["org_ownership", "Organizational Ownership"],
  ] as const;

  const dimensionTotals = new Map<string, { name: string; sum: number; count: number }>();
  for (const obs of row.observations) {
    for (const s of obs.scores) {
      const entry = dimensionTotals.get(s.dimensionCode) || { name: s.dimension, sum: 0, count: 0 };
      entry.sum += s.levelValue;
      entry.count += 1;
      dimensionTotals.set(s.dimensionCode, entry);
    }
  }

  const dimensionScores = allDimCodes.map(([code, name]: readonly [string, string]) => {
    const entry = dimensionTotals.get(code);
    return { code, name, score: entry && entry.count > 0 ? entry.sum / entry.count : null };
  });

  const scored = dimensionScores.filter((d) => d.score !== null);
  const sorted = [...scored].sort((a, b) => (b.score || 0) - (a.score || 0));
  const strengths = sorted.slice(0, 3);
  const developments = [...sorted].reverse().slice(0, 3).filter((d) => !strengths.some((s) => s.code === d.code));

  const captain = row.members.find((m) => m.is_captain);
  const roster = row.members;

  const document = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>Bina<Text style={styles.logoAccent}>Hub</Text></Text>
          </View>
          <View>
            <Text style={styles.title}>Laporan Per Tim</Text>
            <Text style={styles.badge}>Dibuat {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</Text>
          </View>
        </View>

        <Text style={{ fontSize: 16, fontWeight: 700, color: "#0B2C6B" }}>{team.name}</Text>
        <Text style={styles.badge}>Batch {batchLabel}</Text>

        {/* Roster */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profil Tim</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1, backgroundColor: "#F8F9FC", borderRadius: 6, padding: 8 }}>
              <Text style={{ fontSize: 7, textTransform: "uppercase", color: "#64748B", letterSpacing: 0.5 }}>Jumlah Anggota</Text>
              <Text style={{ fontSize: 16, fontWeight: 700, color: "#0B2C6B" }}>{roster.length}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#F8F9FC", borderRadius: 6, padding: 8 }}>
              <Text style={{ fontSize: 7, textTransform: "uppercase", color: "#64748B", letterSpacing: 0.5 }}>Kapten</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: "#D9A441" }}>{captain ? captain.member_name : "-"}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#F8F9FC", borderRadius: 6, padding: 8 }}>
              <Text style={{ fontSize: 7, textTransform: "uppercase", color: "#64748B", letterSpacing: 0.5 }}>Mission Diobservasi</Text>
              <Text style={{ fontSize: 16, fontWeight: 700, color: "#0B2C6B" }}>{observations.length}</Text>
            </View>
          </View>
          {roster.length === 0 ? (
            <Text style={{ fontSize: 9, color: "#64748B", fontStyle: "italic" }}>Roster belum diisi.</Text>
          ) : (
            roster.map((member, i) => (
              <View key={i} style={styles.memberPill}>
                <Text style={styles.captainMark}>{member.is_captain ? "★" : ""}</Text>
                <Text style={{ fontSize: 9, color: "#334155", fontWeight: member.is_captain ? 700 : 400 }}>{member.member_name}</Text>
                {member.is_captain && <Text style={{ fontSize: 7, color: "#D9A441", marginLeft: 4, textTransform: "uppercase" }}>Kapten</Text>}
              </View>
            ))
          )}
        </View>

        {/* Dimension Scores */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Skor 8 Dimensi Perilaku</Text>
          <TeamRadar dimensions={dimensionScores} />
          {dimensionScores.map((dim) => (
            <View key={dim.code} style={styles.dimRow}>
              <Text style={styles.dimName}>{dim.name}</Text>
              <Text style={styles.dimScore}>{dim.score !== null ? `${dim.score.toFixed(1)} / 5.0` : "—"}</Text>
            </View>
          ))}
        </View>

        {/* Strengths & Development */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kekuatan & Area Pengembangan Tim</Text>
          <View style={{ backgroundColor: "#F0FDF4", borderRadius: 6, padding: 8, marginBottom: 6 }}>
            {strengths.length === 0 ? (
              <Text style={{ fontSize: 8, color: "#64748B", fontStyle: "italic" }}>Belum cukup data.</Text>
            ) : (
              strengths.map((s) => (
                <Text key={s.code} style={{ fontSize: 8.5, color: "#166534", marginBottom: 2 }}>• {s.name} — {s.score!.toFixed(1)}/5.0</Text>
              ))
            )}
          </View>
          <View style={{ backgroundColor: "#FFFBEB", borderRadius: 6, padding: 8 }}>
            {developments.length === 0 ? (
              <Text style={{ fontSize: 8, color: "#64748B", fontStyle: "italic" }}>Belum cukup data.</Text>
            ) : (
              developments.map((d) => (
                <Text key={d.code} style={{ fontSize: 8.5, color: "#92400E", marginBottom: 2 }}>• {d.name} — {d.score!.toFixed(1)}/5.0</Text>
              ))
            )}
          </View>
        </View>

        {/* Observations per mission with facilitator */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Riwayat Observasi per Mission</Text>
          {observations.length === 0 ? (
            <Text style={{ fontSize: 9, color: "#64748B", fontStyle: "italic" }}>Belum ada observasi untuk tim ini.</Text>
          ) : (
            <>
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.headerCell, { flex: 1.2 }]}>Mission</Text>
                <Text style={[styles.headerCell, { width: 60, textAlign: "center" }]}>Skor</Text>
                <Text style={[styles.headerCell, { flex: 1 }]}>Fasilitator</Text>
                <Text style={[styles.headerCell, { flex: 1 }]}>Tanggal</Text>
                <Text style={[styles.headerCell, { width: 55 }]}>Status</Text>
              </View>
              {observations.map((obs, i) => {
                const avg = obs.scores.length > 0 ? obs.scores.reduce((a: number, b: { levelValue: number }) => a + b.levelValue, 0) / obs.scores.length : null;
                return (
                  <View key={i}>
                    <View style={[styles.row, { alignItems: "center" }]}>
                      <Text style={[styles.cell, { flex: 1.2, fontWeight: 600 }]}>{obs.mission}</Text>
                      <Text style={[styles.cell, { width: 60, textAlign: "center", fontWeight: 700, color: "#0B2C6B" }]}>
                        {avg !== null ? avg.toFixed(1) : "-"}
                      </Text>
                      <Text style={[styles.cell, { flex: 1 }]}>{obs.facilitator}</Text>
                      <Text style={[styles.cell, { flex: 1 }]}>{new Date(obs.submittedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</Text>
                      <Text style={[styles.cell, { width: 55 }]}>{obs.status === "locked" ? "Terkunci" : obs.status === "submitted" ? "Ter-submit" : "Draft"}</Text>
                    </View>
                    {obs.notes && <Text style={styles.noteBox}>Catatan: {obs.notes}</Text>}
                  </View>
                );
              })}
            </>
          )}
        </View>

        <Text style={{ position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: "#64748B", paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E2E8F0" }}>
          BinaHub — Human-Centered Transformation Partner · Rahasia
        </Text>
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(document);
  const safeName = team.name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "tim";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="tbos_report_${safeName}_${new Date().toISOString().split("T")[0]}.pdf"`,
    },
  });
}
