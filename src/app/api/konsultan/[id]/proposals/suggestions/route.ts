import { NextRequest } from "next/server";
import { z } from "zod";
import { consultantBody, consultantFailure, consultantJson, requireConsultant } from "@/lib/consultant/http";
import { suggestConsultantPrograms } from "@/lib/consultant/recommendation";
import { readConsultation } from "@/lib/consultant/service";

const input = z.strictObject({ version: z.number().int().nonnegative() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireConsultant(req);
    const id = z.uuid().parse((await ctx.params).id);
    const { version } = input.parse(await consultantBody(req));
    return consultantJson(await suggestConsultantPrograms(await readConsultation(actor.id, id), version));
  } catch (error) {
    return consultantFailure(error);
  }
}
