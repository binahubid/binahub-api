import { after, NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifyProposalToken } from "@/lib/secure-token";
import { createAndSendAutomaticPreliminary } from "@/lib/automatic-preliminary";
import { requestStandardProposal } from "@/lib/standard-proposal-request";
import { proposalRequestPage } from "@/lib/proposal-request-page";
import { recordRuntimeError } from "@/lib/runtime-observability";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff" };
const html = (input: Parameters<typeof proposalRequestPage>[0], status = 200) => new NextResponse(proposalRequestPage(input), { status, headers });

function signedRequest(req: NextRequest) {
  const assessmentId = req.nextUrl.searchParams.get("assessmentId") || "";
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(assessmentId) || !token || !verifyProposalToken(assessmentId, token)) return null;
  return { assessmentId, token };
}

export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "proposal-request", 30, 60 * 60);
  if (limited) return limited;
  const signed = signedRequest(req);
  if (!signed) return html({ state: "error", title: "Tautan tidak tersedia", message: "Silakan gunakan tautan pada email hasil diagnosa Anda. Hubungi BinaHub jika membutuhkan bantuan." }, 400);
  const { data, error } = await createServerSupabase().from("assessments")
    .select("proposal_status,proposal_sent_at,proposal_requested_at,form_data").eq("id", signed.assessmentId).single();
  if (error || !data) return html({ state: "error", title: "Hasil diagnosa tidak ditemukan", message: "Silakan hubungi BinaHub agar kami dapat membantu Anda." }, 404);
  const locale = data.form_data?.locale === "en" ? "en" : "id";
  // GET must remain read-only: mail scanners cannot request/send a proposal.
  if (data.proposal_sent_at || data.proposal_status === "Terkirim") return html({ locale, state: "sent" });
  if (data.proposal_requested_at || data.proposal_status && data.proposal_status !== "Belum Diminta") return html({ locale, state: "received" });
  const action = `/api/proposal/request?assessmentId=${encodeURIComponent(signed.assessmentId)}&token=${encodeURIComponent(signed.token)}`;
  return html({ locale, state: "confirm", action });
}

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "proposal-confirm", 10, 60 * 60);
  if (limited) return limited;
  const signed = signedRequest(req);
  if (!signed) return html({ state: "error", title: "Tautan tidak tersedia", message: "Silakan gunakan tautan pada email hasil diagnosa Anda." }, 400);
  try {
    const result = await requestStandardProposal(signed.assessmentId);
    if (result.outcome === "queued") {
      after(async () => {
        try { await createAndSendAutomaticPreliminary(signed.assessmentId, result.requestedAt); }
        catch (error) { await recordRuntimeError({ code: "STANDARD_PROPOSAL_BACKGROUND_FAILED", message: error instanceof Error ? error.message : String(error), route: "/api/proposal/request" }); }
      });
    }
    // Confirm immediately; AI and email delivery continue on the server even
    // after the visitor closes the tab. PRG avoids resubmission on refresh.
    const location = new URL("/api/proposal/request", req.url);
    location.searchParams.set("assessmentId", signed.assessmentId);
    location.searchParams.set("token", signed.token);
    return NextResponse.redirect(location, { status: 303, headers });
  } catch (error) {
    await recordRuntimeError({ code: "STANDARD_PROPOSAL_REQUEST_FAILED", message: error instanceof Error ? error.message : String(error), route: "/api/proposal/request" });
    return html({ state: "error", message: "Permintaan belum berhasil dikirim. Silakan coba lagi melalui tautan pada email Anda." }, 503);
  }
}
