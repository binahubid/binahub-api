import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consultantFailure, consultantHeaders, ConsultantError, requireConsultant } from "@/lib/consultant/http";
import { readConsultantRecommendation } from "@/lib/consultant/recommendation";
import { readConsultation } from "@/lib/consultant/service";
import { renderSpinPDF } from "@/lib/spin/pdf";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireConsultant(req);
    const id = z.uuid().parse((await ctx.params).id);
    const initial = await readConsultantRecommendation(await readConsultation(actor.id, id), true);
    if (!initial?.report) throw new ConsultantError("CONSULTANT_NOT_FOUND", 404);
    const pdf = initial.pdf ? Buffer.from(initial.pdf, "base64") : await renderSpinPDF(initial.report);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...consultantHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="BinaHub-Rekomendasi-Awal.pdf"',
      },
    });
  } catch (error) {
    return consultantFailure(error);
  }
}
