import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import { readConsultation } from "@/lib/consultant/service";
import { getConsultantEmailIdentity, queueConsultantMessage } from "@/lib/consultant/messages";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const actor = await requireConsultant(req);
    const id = z.uuid().parse((await ctx.params).id);
    return consultantJson(await getConsultantEmailIdentity(await readConsultation(actor.id, id)));
  } catch (e) {
    return consultantFailure(e);
  }
}
export async function POST(
  req: NextRequest,
  ctx: Context,
) {
  try {
    const a = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id);
    const message = await queueConsultantMessage(
      a.id,
      id,
      await readConsultation(a.id, id),
      await consultantBody(req),
    );
    // The existing minute worker performs delivery; never hold navigation for a provider call.
    return consultantJson({ message }, 202);
  } catch (e) {
    return consultantFailure(e);
  }
}
