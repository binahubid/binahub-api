import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "csv";

  const db = createServerSupabase();

  const { data: observations, error } = await db
    .from("tbos_observations")
    .select(`
      id,
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

  return NextResponse.json({ success: false, error: "Format tidak didukung." }, { status: 400 });
}

function escapeCsv(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
