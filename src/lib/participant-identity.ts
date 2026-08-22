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

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function findSimilarParticipantNames(existingNames: string[], displayName: string) {
  const identity = normalizeParticipantName(displayName);
  return existingNames.filter((name) => {
    const candidate = normalizeParticipantName(name);
    if (!candidate || candidate === identity) return false;
    const shorter = candidate.length < identity.length ? candidate : identity;
    const longer = candidate.length < identity.length ? identity : candidate;
    return editDistance(candidate, identity) <= 2
      || (shorter.length >= 5 && longer.startsWith(shorter));
  });
}
