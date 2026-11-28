import type { NextRequest } from "next/server";
import { z } from "zod";
import { callAms } from "@/lib/ams-client";
import { createServerSupabase } from "@/lib/supabase";

export const referralCode = z.string().trim().toUpperCase().regex(/^BH-[A-F0-9]{10}$/);
export const referralCookie = "bh_referral";

type Visit = {
  associateId: string;
  code: string;
  visitId: string;
  expiresAt: string;
  method: "link" | "manual";
};

export async function referralRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createServerSupabase().rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function readReferralVisit(request: NextRequest) {
  const parsed = z.uuid().safeParse(request.cookies.get(referralCookie)?.value);
  return parsed.success ? parsed.data : null;
}

export async function referralAssociateIsActive(associateId: string) {
  const result = await callAms<{ success: true; active: boolean }>(
    "/api/integrations/app/referrals/eligible", { associateId }, 3000,
  );
  return result.active === true;
}

export function lookupReferral(visitId: string | null, code: string | null = null) {
  return referralRpc<Visit | null>("referral_lookup", { p_visit: visitId, p_code: code });
}

export async function referralAttribution(request: NextRequest, consentCode?: string) {
  const visitId = readReferralVisit(request);
  const visit = visitId ? await lookupReferral(visitId) : null;
  if (!visit || !await referralAssociateIsActive(visit.associateId)) return { visitId: null, share: false };
  return { visitId: visit.visitId, share: Boolean(consentCode && consentCode === visit.code) };
}

export function publicReferralContext(visit: Visit | null) {
  if (!visit) return null;
  return { code: visit.code, expiresAt: visit.expiresAt, method: visit.method };
}

export function referralBookingDestination() {
  const value = process.env.CALCOM_BOOKING_URL || process.env.NEXT_PUBLIC_CALCOM_BOOKING_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && ["cal.com", "app.cal.com"].includes(url.hostname)
        && !url.username && !url.password && !url.port && url.pathname !== "/") return url;
  } catch {
    return null;
  }
  return null;
}
