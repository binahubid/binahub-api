import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import { readConsultation } from "@/lib/consultant/service";
import { queueConsultantMessage } from "@/lib/consultant/messages";
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
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
