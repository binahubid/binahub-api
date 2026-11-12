import { timingSafeEqual } from "node:crypto";

export function hasReportWorkerAuthorization(authorization: string | null) {
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(secret);
  const received = Buffer.from(authorization.slice(7));
  return received.length === expected.length && timingSafeEqual(received, expected);
}
