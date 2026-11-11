import { NextRequest } from "next/server";
import { z } from "zod";
import {
  consultantFailure,
  consultantJson,
  consultantRPC,
  requireConsultant,
} from "@/lib/consultant/http";
import { consultantQuery } from "@/lib/consultant/schemas";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireConsultant(req),
      q = consultantQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    const kind = z
      .enum(["tasks", "bookings"])
      .parse(req.nextUrl.searchParams.get("kind") || "tasks");
    return consultantJson(
      await consultantRPC("consultant_agenda", {
        p_actor: actor.id,
        p_page: q.page,
        p_owner: q.owner,
        p_kind: kind,
      }),
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
