import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "csv";
  const programId = url.searchParams.get("programId");

  const db = createServerSupabase();

  let { data: observations, error } = await db
    .from("tbos_observations")
    .select(`
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
    .order("submitted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (programId) {
    const { data: teams, error: teamError } = await db
      .from("tbos_teams")
      .select("id")
      .eq("engagement_id", programId);
    if (teamError) return NextResponse.json({ success: false, error: teamError.message }, { status: 500 });
    const teamIds = new Set((teams || []).map((team) => team.id));
    observations = (observations || []).filter((observation) => teamIds.has(observation.team_id));
  }

  if (format === "csv") {
    const rows: string[] = [];

    rows.push("Team,Mission,Batch,Facilitator,Observed At,Submitted At,Status,Dimension,Level Value,Level Label,Notes");

    for (const obs of observations || []) {
      const teamName = (obs as any).tbos_teams?.name || "";
      const missionName = (obs as any).tbos_missions?.name || "";
      const facilitatorName = (obs as any).profiles?.full_name || "";
      const scores = (obs as any).tbos_observation_scores || [];

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
    const rows = observations || [];
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
                <Text style={styles.cell}>{(obs as any).tbos_teams?.name || "-"}</Text>
                <Text style={styles.cell}>{(obs as any).tbos_missions?.name || "-"}</Text>
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
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
