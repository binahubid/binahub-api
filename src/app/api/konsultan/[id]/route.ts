import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import { readConsultation, saveConsultation } from "@/lib/consultant/service";
type Context = { params: Promise<{ id: string }> };
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
    return consultantJson(await readConsultation(actor.id, id, page));
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
