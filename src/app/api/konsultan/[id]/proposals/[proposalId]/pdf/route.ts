import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consultantFailure,
  consultantHeaders,
  requireConsultant,
  ConsultantError,
} from "@/lib/consultant/http";
import { readConsultation } from "@/lib/consultant/service";
import { consultantProposalPDF } from "@/lib/consultant/pdf";
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
    return new NextResponse(
      new Uint8Array(
        await consultantProposalPDF(
          proposal.snapshot as ProposalSnapshot,
          proposal.revision,
        ),
      ),
      {
        headers: {
          ...consultantHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="BinaHub-Proposal-r${proposal.revision}.pdf"`,
        },
      },
    );
  } catch (e) {
    return consultantFailure(e);
  }
}
