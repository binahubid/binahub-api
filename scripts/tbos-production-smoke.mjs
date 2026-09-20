import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.TBOS_API_URL || "https://api.binahub.id").trim().replace(/\/$/, "");
const failures = [];

function required(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Environment ${names.join(" atau ")} belum tersedia.`);
}

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Request-ID": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

check(/^https:\/\//i.test(baseUrl), "target T-BOS memakai HTTPS");
if (failures.length) process.exit(1);

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: required("TBOS_ADMIN_EMAIL", "E2E_ADMIN_EMAIL"),
  password: required("TBOS_ADMIN_PASSWORD", "E2E_ADMIN_PASSWORD"),
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara", authError?.message || "");
if (!token || failures.length) process.exit(1);

let createdBatchId = "";
let createdTeamId = "";

try {
  const anonymousPaths = [
    "/api/tbos/teams?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/dashboard?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/batches?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/missions?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/observations?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/export?format=csv&programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/facilitator-missions?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/facilitator-mission-selection?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/teams/members?teamId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/participant/team-info?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/live-score?programId=00000000-0000-0000-0000-000000000000",
    "/api/tbos/program-competencies?programId=00000000-0000-0000-0000-000000000000",
  ];
  const [anonymousResults, programsResult] = await Promise.all([
    Promise.all(anonymousPaths.map((path) => request(path))),
    request("/api/programs/available?moduleKey=tbos", { token }),
  ]);

  check(
    anonymousResults.every((result) => result.response.status === 401),
    "seluruh endpoint baca T-BOS menolak anonim",
    `${anonymousResults.filter((result) => result.response.status === 401).length}/${anonymousResults.length}`,
  );
  check(
    programsResult.response.status === 200 && programsResult.payload?.success === true
      && Array.isArray(programsResult.payload?.programs),
    "admin dapat membaca program T-BOS",
    `HTTP ${programsResult.response.status}`,
  );

  const programs = Array.isArray(programsResult.payload?.programs) ? programsResult.payload.programs : [];
  check(programs.length > 0, "minimal satu program T-BOS aktif tersedia", `${programs.length} program`);

  if (programs[0]?.id) {
    const [liveScoreResult, competencyResult] = await Promise.all([
      request(`/api/tbos/live-score?programId=${encodeURIComponent(programs[0].id)}`, { token }),
      request(`/api/tbos/program-competencies?programId=${encodeURIComponent(programs[0].id)}`, { token }),
    ]);
    const serializedLiveScore = JSON.stringify(liveScoreResult.payload || {});
    check(
      liveScoreResult.response.status === 200
        && liveScoreResult.payload?.success === true
        && liveScoreResult.payload?.liveScoreReady === true
        && ["leaderboard", "countdown"].includes(liveScoreResult.payload?.session?.displayFocus)
        && Array.isArray(liveScoreResult.payload?.leaderboard),
      "admin dapat membaca agregat Live Score T-BOS",
      `HTTP ${liveScoreResult.response.status}`,
    );
    check(
      !serializedLiveScore.includes("facilitator_notes")
        && !serializedLiveScore.includes("participant_name")
        && !serializedLiveScore.includes("member_name")
        && !serializedLiveScore.includes("@"),
      "Live Score tidak mengekspos identitas peserta atau catatan fasilitator",
    );
    check(
      competencyResult.response.status === 200
        && competencyResult.payload?.success === true
        && Array.isArray(competencyResult.payload?.dimensions)
        && competencyResult.payload.dimensions.length === 8
        && Array.isArray(competencyResult.payload?.selectedDimensionIds)
        && competencyResult.payload.selectedDimensionIds.length >= 1
        && competencyResult.payload.selectedDimensionIds.length <= 8,
      "admin dapat membaca 1-8 kompetensi program",
      `HTTP ${competencyResult.response.status}`,
    );
  }

  if (process.env.TBOS_MUTATION_TEST === "true" && programs[0]?.id) {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const batchName = `Gelombang UAT ${suffix}`.slice(0, 50);
    const teamName = `Tim UAT ${suffix}`.slice(0, 50);
    const renamedTeam = `Tim UAT Renamed ${suffix}`.slice(0, 50);
    const programId = programs[0].id;

    const batchResult = await request("/api/tbos/batches", {
      token,
      method: "POST",
      body: { programId, name: batchName },
    });
    createdBatchId = batchResult.payload?.batch?.id || "";
    check(batchResult.response.status === 200 && Boolean(createdBatchId), "batch bernama bebas dapat dibuat", `HTTP ${batchResult.response.status}`);

    if (createdBatchId) {
      const teamResult = await request("/api/tbos/teams", {
        token,
        method: "POST",
        body: { programId, batchId: createdBatchId, name: teamName },
      });
      createdTeamId = teamResult.payload?.team?.id || "";
      check(
        teamResult.response.status === 200 && Boolean(createdTeamId)
          && teamResult.payload?.team?.batch === batchName,
        "tim dapat dibuat pada batch bernama bebas",
        `HTTP ${teamResult.response.status}`,
      );

      if (createdTeamId) {
        const renameResult = await request(`/api/tbos/teams/${createdTeamId}`, {
          token,
          method: "PATCH",
          body: { name: renamedTeam },
        });
        check(renameResult.response.status === 200 && renameResult.payload?.team?.name === renamedTeam, "nama tim dapat diubah");

        const listResult = await request(`/api/tbos/teams?programId=${encodeURIComponent(programId)}`, { token });
        check(
          listResult.response.status === 200
            && listResult.payload?.teams?.some((team) => team.id === createdTeamId && team.batchName === batchName),
          "tim baru dapat dibaca kembali dengan lineage batch",
        );

        const membersResult = await request("/api/tbos/teams/members", {
          token,
          method: "POST",
          body: {
            teamId: createdTeamId,
            members: [
              { memberName: `Captain ${suffix}`.slice(0, 100), isCaptain: true },
              { memberName: `Member ${suffix}`.slice(0, 100), isCaptain: false },
            ],
          },
        });
        const insertedMembers = Array.isArray(membersResult.payload?.members)
          ? membersResult.payload.members
          : [];
        check(
          membersResult.response.status === 200
            && insertedMembers.length === 2
            && insertedMembers.filter((member) => member.is_captain).length === 1,
          "roster atomik menyimpan dua anggota dengan tepat satu kapten",
          `HTTP ${membersResult.response.status}`,
        );
      }
    }
  } else {
    console.log("[SKIP] mutation smoke tidak diminta; set TBOS_MUTATION_TEST=true untuk create/rename/read/delete terkontrol.");
  }
} finally {
  if (createdTeamId) {
    const deleted = await request(`/api/tbos/teams/${createdTeamId}`, { token, method: "DELETE" });
    check(deleted.response.status === 200 && deleted.payload?.success === true, "tim UAT dibersihkan");
  }
  if (createdBatchId) {
    const deleted = await request(`/api/tbos/batches/${createdBatchId}`, { token, method: "DELETE" });
    check(deleted.response.status === 200 && deleted.payload?.success === true, "batch UAT dibersihkan");
  }
  await supabase.auth.signOut({ scope: "local" });
}

if (failures.length) {
  console.error(`\nT-BOS production smoke gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nT-BOS production smoke lulus terhadap ${baseUrl}.`);
console.log(process.env.TBOS_MUTATION_TEST === "true"
  ? "Data UAT sementara dibuat dan dibersihkan kembali."
  : "Runner read-only; tidak ada data T-BOS yang diubah.");
