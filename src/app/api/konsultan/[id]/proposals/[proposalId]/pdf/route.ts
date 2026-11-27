import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consultantFailure,
  consultantHeaders,
  requireConsultant,
  ConsultantError,
} from "@/lib/consultant/http";
import { readConsultation } from "@/lib/consultant/service";
import { consultantProposalFilename, consultantProposalPDF } from "@/lib/consultant/pdf";
import type { ProposalSnapshot } from "@/lib/consultant/proposal";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; proposalId: string }> },
) {
  try {
    const a = await requireConsultant(req),
      p = await ctx.params;
    const d = await readConsultation(a.id, z.uuid().parse(p.id)),
      proposal = d.proposals.find((r) => r.id === z.uuid().parse(p.proposalId));
    if (!proposal) throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const snapshot = proposal.snapshot as ProposalSnapshot;
    return new NextResponse(
      new Uint8Array(
        await consultantProposalPDF(
          snapshot,
          proposal.id,
        ),
      ),
      {
        headers: {
          ...consultantHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${consultantProposalFilename(snapshot.issuedAt, proposal.id)}"`,
          "Access-Control-Expose-Headers": "Content-Disposition",
        },
      },
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
