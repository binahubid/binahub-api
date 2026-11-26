import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import { readConsultation, saveConsultation } from "@/lib/consultant/service";
import { withConsultantOrigins } from "@/lib/consultant/origin";
type Context = { params: Promise<{ id: string }> };

function configuredCalBookingUrl() {
  const configured = process.env.CALCOM_BOOKING_URL || process.env.NEXT_PUBLIC_CALCOM_BOOKING_URL;
  if (!configured) return;
  try {
    const url = new URL(configured);
    if (url.origin !== "https://cal.com" || url.username || url.password
      || url.pathname.split("/").filter(Boolean).length < 2) return;
    return url.toString();
  } catch {
    return;
  }
}

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const actor = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id);
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(req.nextUrl.searchParams.get("page") || 0);
    const detail = await readConsultation(actor.id, id, page);
    const [record] = await withConsultantOrigins([detail.record]);
    const bookingUrl = detail.workspace && record.canEdit && record.assigneeId && record.email
      && !record.handoff && !["won", "lost"].includes(record.stage) ? configuredCalBookingUrl() : undefined;
    return consultantJson({ ...detail, record, bookingUrl });
  } catch (e) {
    return consultantFailure(e);
  }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const actor = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id);
    return consultantJson(
      await saveConsultation(actor.id, id, await consultantBody(req)),
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
