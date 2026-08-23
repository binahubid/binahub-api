export const ACTIVE_PROGRAM_STATUSES = ["active", "in_progress", "review"] as const;

export interface ClientProgramRow {
  id: string;
  code: string;
  title: string;
  organization_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  organization?: { name: string } | Array<{ name: string }> | null;
}

export function participantAccessExpiry(endDate: string | null, now = Date.now()) {
  if (endDate) {
    const expiry = new Date(`${endDate}T23:59:59.999+07:00`);
    if (!Number.isNaN(expiry.getTime())) return expiry.toISOString();
  }
  return new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString();
}

export function programAccessAvailable(program: Pick<ClientProgramRow, "status" | "end_date">, now = Date.now()) {
  if (!ACTIVE_PROGRAM_STATUSES.includes(program.status as typeof ACTIVE_PROGRAM_STATUSES[number])) return false;
  return new Date(participantAccessExpiry(program.end_date, now)).getTime() >= now;
}

export function publicProgram(program: ClientProgramRow, modules: Array<"tbos" | "lep" | "binainsight">) {
  const companyName = Array.isArray(program.organization)
    ? program.organization[0]?.name
    : program.organization?.name;
  return {
    id: program.id,
    title: program.title,
    companyName: companyName || "Perusahaan",
    location: program.location,
    status: program.status,
    startDate: program.start_date,
    endDate: program.end_date,
    modules,
    available: programAccessAvailable(program),
  };
}
