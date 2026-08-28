export type FollowUpWindowPolicy = {
  timeZone: string;
  startHour: number;
  endHour: number;
  weekdays: number[];
  holidays: string[];
};

export const DEFAULT_FOLLOW_UP_WINDOW: FollowUpWindowPolicy = {
  timeZone: "Asia/Jakarta",
  startHour: 8,
  endHour: 17,
  weekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

export const MAX_FOLLOW_UP_MESSAGES_PER_OPPORTUNITY = 3;
export const FOLLOW_UP_ACTIVE_BOOKING_STATUSES = new Set(["requested", "confirmed", "rescheduled"]);
export const FOLLOW_UP_STOP_OPPORTUNITY_STAGES = new Set(["consultation", "negotiation", "won", "lost"]);

export function followUpStopReason(input: {
  sentCount: number;
  bookingStatus?: string | null;
  opportunityStage?: string | null;
}) {
  if (input.sentCount >= MAX_FOLLOW_UP_MESSAGES_PER_OPPORTUNITY) return "MAX_MESSAGES_REACHED" as const;
  if (FOLLOW_UP_ACTIVE_BOOKING_STATUSES.has(String(input.bookingStatus || "").toLowerCase())) {
    return "MEETING_BOOKED" as const;
  }
  if (FOLLOW_UP_STOP_OPPORTUNITY_STAGES.has(String(input.opportunityStage || "").toLowerCase())) {
    return "OPPORTUNITY_ACTIVE_OR_CLOSED" as const;
  }
  return null;
}

function integerInRange(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function followUpWindowFromEnvironment(env: Record<string, string | undefined> = process.env): FollowUpWindowPolicy {
  const weekdays = String(env.FOLLOW_UP_WEEKDAYS || "1,2,3,4,5")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const holidays = String(env.FOLLOW_UP_HOLIDAYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return {
    timeZone: env.FOLLOW_UP_TIME_ZONE || DEFAULT_FOLLOW_UP_WINDOW.timeZone,
    startHour: integerInRange(env.FOLLOW_UP_WINDOW_START, DEFAULT_FOLLOW_UP_WINDOW.startHour, 0, 23),
    endHour: integerInRange(env.FOLLOW_UP_WINDOW_END, DEFAULT_FOLLOW_UP_WINDOW.endHour, 1, 24),
    weekdays: weekdays.length ? weekdays : DEFAULT_FOLLOW_UP_WINDOW.weekdays,
    holidays,
  };
}

export function evaluateFollowUpWindow(now = new Date(), policy = DEFAULT_FOLLOW_UP_WINDOW) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[value("weekday")];
  const hour = Number(value("hour"));
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const isHoliday = policy.holidays.includes(localDate);
  const allowed = policy.weekdays.includes(weekday) && !isHoliday && hour >= policy.startHour && hour < policy.endHour;
  return { allowed, localDate, weekday, hour, isHoliday, policy };
}
