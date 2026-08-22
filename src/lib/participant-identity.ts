export function normalizeParticipantName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("id-ID");
}

export function matchingParticipantAccesses<T extends { team_name: string }>(rows: T[], displayName: string) {
  const identity = normalizeParticipantName(displayName);
  return rows.filter((row) => normalizeParticipantName(row.team_name) === identity);
}

export function hasAmbiguousParticipantIdentity(rows: Array<{ participant_id: string | null }>) {
  return new Set(rows.map((row) => row.participant_id).filter(Boolean)).size > 1;
}
