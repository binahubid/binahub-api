import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import { readConsultation } from "@/lib/consultant/service";
import { storeConsultantProposal } from "@/lib/consultant/proposal";
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const a = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id);
    return consultantJson(
      await storeConsultantProposal(
        a.id,
        id,
        await readConsultation(a.id, id),
        await consultantBody(req),
      ),
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
