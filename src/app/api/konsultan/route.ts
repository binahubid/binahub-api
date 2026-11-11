import { NextRequest } from "next/server";
import {
  consultantFailure,
  consultantJson,
  consultantRPC,
  requireConsultant,
} from "@/lib/consultant/http";
import { consultantQuery } from "@/lib/consultant/schemas";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
export async function GET(req: NextRequest) {
  try {
    const actor = await requireConsultant(req),
      q = consultantQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await consultantRPC<Record<string, unknown>>(
      "consultant_portal_read",
      {
        p_actor: actor.id,
        p_page: q.page,
        p_search: q.search,
        p_owner: q.owner,
        p_view: q.view,
      },
    );
    return consultantJson({
      ...result,
      catalog: SPIN_CATALOG.modules.map(
        ({ code, name, dailyRateIdr, capacity, pricingModel }) => ({
          code,
          name,
          dailyRateIdr,
          capacity,
          pricingModel,
        }),
      ),
    });
  } catch (e) {
    return consultantFailure(e);
  }
}
