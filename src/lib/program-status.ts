export type ProgramStatus = "draft" | "active" | "in_progress" | "review" | "completed" | "archived";

export function jakartaCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function resolveScheduledProgramStatus(input: {
  status: ProgramStatus;
  startDate: string | null;
  endDate: string | null;
}, today = jakartaCalendarDate()): ProgramStatus {
  if (input.status === "active") {
    if (input.endDate && input.endDate < today) return "review";
    if (input.startDate && input.startDate <= today) return "in_progress";
  }
  if (input.status === "in_progress") {
    if (input.endDate && input.endDate < today) return "review";
    if (input.startDate && input.startDate > today) return "active";
  }
  return input.status;
}
