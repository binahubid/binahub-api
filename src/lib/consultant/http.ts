import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { getAuthoritativeUserRole, getUserFromBearer } from "@/lib/auth-role";
import { spinBody, spinOrigin } from "@/lib/spin/http";
import { SpinError } from "@/lib/spin/intake";
import { assertActiveConsultantMembership, ConsultantMembershipError } from "./membership";

export const consultantHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
export const consultantJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: consultantHeaders });

export class ConsultantError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export async function consultantRPC<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await createServerSupabase().rpc(name, args);
  if (error) {
    if (["42883", "42P01", "PGRST202", "PGRST205"].includes(error.code || ""))
      throw new ConsultantError(name === "consultant_ams_roster" ? "CONSULTANT_AMS_SETUP_REQUIRED" : "CONSULTANT_SETUP_REQUIRED", 503);
    const code = /CONSULTANT_[A-Z_]+/.exec(error.message)?.[0];
    if (!code) throw new ConsultantError("CONSULTANT_UNAVAILABLE", 503);
    throw new ConsultantError(
      code,
      code.includes("FORBIDDEN") ||
        code.includes("ASSIGNED") ||
        code.includes("ADMIN_REQUIRED")
        ? 403
        : code.includes("NOT_FOUND")
          ? 404
          : 409,
    );
  }
  return data as T;
}

export async function requireConsultant(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth)
    throw new ConsultantError("CONSULTANT_SIGN_IN", auth.status);
  const role = await getAuthoritativeUserRole(auth.user);
  if (role !== "admin" && role !== "consultant" && role !== "facilitator")
    throw new ConsultantError("CONSULTANT_FORBIDDEN", 403);
  const admin = await consultantRPC<boolean>("consultant_actor", {
    p_actor: auth.user.id,
  });
  if (!admin) await assertActiveConsultantMembership(auth.user.id);
  return {
    id: auth.user.id,
    role,
    isAdmin: admin,
    name: String(auth.user.user_metadata?.full_name || auth.user.email || ""),
  };
}

export async function consultantBody(req: NextRequest) {
  spinOrigin(req);
  return spinBody(req);
}

export function consultantFailure(error: unknown) {
  if (error instanceof ConsultantMembershipError)
    return consultantFailure(new ConsultantError(error.code, error.code === "CONSULTANT_FORBIDDEN" ? 403 : 503));
  if (error instanceof SpinError) {
    const status =
      error.code === "SPIN_FORBIDDEN"
        ? 403
        : error.code === "SPIN_TOO_LARGE"
          ? 413
          : 422;
    return consultantJson(
      {
        success: false,
        error: "Periksa kelengkapan jawaban dan isian Anda.",
        code: error.code,
      },
      status,
    );
  }
  if (error instanceof z.ZodError)
    return consultantJson(
      {
        success: false,
        error: "Periksa kembali isian yang diperlukan.",
        code: "CONSULTANT_INVALID",
      },
      400,
    );
  const code =
    error instanceof ConsultantError ? error.code : "CONSULTANT_UNAVAILABLE";
  const messages: Record<string, string> = {
    CONSULTANT_SETUP_REQUIRED:
      "Portal memerlukan pembaruan database SQL90. Hubungi penanggung jawab sistem.",
    CONSULTANT_SIGN_IN: "Silakan masuk kembali untuk melanjutkan.",
    CONSULTANT_FORBIDDEN: "Akun ini belum memiliki akses konsultan yang aktif.",
    CONSULTANT_NOT_ASSIGNED:
      "Pekerjaan ini hanya dapat diubah oleh penanggung jawabnya.",
    CONSULTANT_ADMIN_REQUIRED: "Tindakan ini memerlukan admin.",
    CONSULTANT_MANAGE_IN_AMS: "Kelola keanggotaan dan persetujuan konsultan melalui AMS.",
    CONSULTANT_NOT_FOUND: "Pekerjaan tidak ditemukan.",
    CONSULTANT_CONFLICT:
      "Pekerjaan telah berubah. Muat versi terbaru sebelum melanjutkan.",
    CONSULTANT_SOURCE_LOCKED:
      "Jawaban konsultasi sudah dilengkapi. Hubungi admin untuk mengganti sumber.",
    CONSULTANT_INVALID_SOURCE:
      "Pengisian klien tidak sesuai dengan konsultasi ini.",
    CONSULTANT_CHECKLIST_REQUIRED:
      "Lengkapi dan selesaikan kebutuhan sebelum menyusun proposal.",
    CONSULTANT_STALE_PROPOSAL:
      "Kebutuhan telah berubah. Buat revisi proposal sebelum mengirim.",
    CONSULTANT_PROPOSAL_REQUIRED:
      "Siapkan proposal yang sesuai sebelum melanjutkan.",
    CONSULTANT_PROGRAM_UNAVAILABLE:
      "Program tidak tersedia untuk kebutuhan ini. Khusus SS-27, pastikan klien sudah memilih pendekatan spiritual pada checklist.",
    CONSULTANT_CLOSED:
      "Peluang sudah ditutup. Tinjau tahapnya sebelum menjadwalkan pesan.",
    CONSULTANT_SEND_IN_FLIGHT:
      "Pengiriman sedang diproses. Coba lagi setelah hasilnya tercatat.",
    CONSULTANT_INVALID_MEMBER:
      "Pilih konsultan dengan akun dan akses yang sesuai.",
    CONSULTANT_AMS_REQUIRED:
      "Akun ini belum tercatat sebagai associate aktif di AMS dengan email yang sama.",
    CONSULTANT_AMS_UNAVAILABLE:
      "Daftar akun AMS belum dapat diperiksa. Coba lagi beberapa saat.",
    CONSULTANT_AMS_SETUP_REQUIRED:
      "Daftar konsultan belum siap. Hubungi admin BinaHub untuk melengkapi integrasi AMS.",
    CONSULTANT_EMAIL_SETUP:
      "Pengiriman email bisnis belum siap. Hubungi admin untuk memeriksa koneksinya.",
    CONSULTANT_MATERIAL_UNAVAILABLE:
      "Dokumen ini belum diunggah. Hubungi admin BinaHub.",
    CONSULTANT_INVALID_PDF:
      "Pilih dokumen PDF yang valid dengan ukuran maksimal 4 MB.",
  };
  return consultantJson(
    {
      success: false,
      code,
      error:
        messages[code] ||
        "Pekerjaan belum dapat diproses. Coba lagi setelah memperbarui data.",
    },
    error instanceof ConsultantError ? error.status : 503,
  );
}
