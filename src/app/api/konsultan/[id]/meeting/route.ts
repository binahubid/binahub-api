import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantBody,
  consultantFailure,
  consultantJson,
  requireConsultant,
} from "@/lib/consultant/http";
import {
  meetingContext,
  readConsultation,
  saveConsultation,
} from "@/lib/consultant/service";
import { MeetingWriteSchema } from "@/lib/spin/meeting";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const a = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id);
    return consultantJson(meetingContext(await readConsultation(a.id, id)));
  } catch (e) {
    return consultantFailure(e);
  }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const a = await requireConsultant(req),
      id = z.uuid().parse((await ctx.params).id),
      v = MeetingWriteSchema.parse(await consultantBody(req));
    return consultantJson(
      meetingContext(
        await saveConsultation(a.id, id, {
          action: "meeting",
          version: v.revision,
          answers: v.answers,
          notes: v.notes,
          status: v.status,
        }),
      ),
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
