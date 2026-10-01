import { NextRequest, NextResponse } from "next/server";
import { generateProposalPDFBuffer, type ProposalResult } from "@/lib/pdf-service";
import { createServerSupabase } from "@/lib/supabase";
import { verifyProposalViewToken } from "@/lib/secure-token";
import type { AssessmentData } from "@/lib/validations";

export const runtime = "nodejs";
export const maxDuration = 60;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: NextRequest) {
  const assessmentId = request.nextUrl.searchParams.get("assessmentId") || "";
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId) || !token || !verifyProposalViewToken(assessmentId, token)) {
    return NextResponse.json({ error: "Tautan proposal tidak valid atau sudah kedaluwarsa." }, { status: 404, headers: privateHeaders });
  }

  const db = createServerSupabase();
  const { data, error } = await db.from("assessments")
    .select("form_data, proposal_data, proposal_status, proposal_sent_at")
    .eq("id", assessmentId)
    .single();
  if (error || !data || data.proposal_status !== "Terkirim" || !data.proposal_sent_at || !data.proposal_data) {
    return NextResponse.json({ error: "Proposal belum tersedia. Silakan hubungi tim BinaHub." }, { status: 404, headers: privateHeaders });
  }

  const formData = data.form_data as AssessmentData;
  const proposal = data.proposal_data as ProposalResult;
  const locale = formData.locale === "en" ? "en" : "id";
  if (request.nextUrl.searchParams.get("format") === "pdf") {
    const pdf = await generateProposalPDFBuffer(formData, proposal, locale, data.proposal_sent_at);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="BinaHub-Proposal-${assessmentId.slice(0, 8)}.pdf"`,
      },
    });
  }

  // Never return raw assessment answers, contact email, or hidden catalogue prices.
  const commercialItems = Array.isArray(proposal.commercialSnapshot?.items)
    ? proposal.commercialSnapshot.items
    : [];
  const publicProposal = {
    documentKind: proposal.documentKind,
    proposalType: proposal.proposalType,
    subject: proposal.subject,
    opening: proposal.opening,
    proposedProgram: proposal.proposedProgram,
    scope: proposal.scope,
    timeline: proposal.timeline,
    investmentNote: proposal.investmentNote,
    nextStep: proposal.nextStep,
    learningObjectives: proposal.learningObjectives,
    selectedSolutions: proposal.selectedSolutions,
    commercialSnapshot: proposal.commercialSnapshot && {
      items: commercialItems.map(({ name, quantity, pricingUnit }) => ({ name, quantity, pricingUnit })),
      totalBeforeTax: proposal.proposalType === "custom" ? proposal.commercialSnapshot.totalBeforeTax : undefined,
      currency: proposal.commercialSnapshot.currency,
      validityDays: proposal.commercialSnapshot.validityDays,
    },
  };
  return NextResponse.json({
    company: formData.company || "",
    contactName: formData.name || "",
    challenge: formData.challenge || "",
    issuedAt: data.proposal_sent_at,
    locale,
    proposal: publicProposal,
  }, { headers: privateHeaders });
}
