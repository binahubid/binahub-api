import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function page(title: string, message: string, action?: string) {
  const form = action
    ? `<form method="post" action="${escapeHtml(action)}"><button type="submit">Berhenti menerima email follow-up</button></form>`
    : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f4f7fb;color:#163055;font-family:Arial,sans-serif}.card{box-sizing:border-box;max-width:620px;margin:10vh auto;padding:40px;background:#fff;border:1px solid #dce5f0;border-radius:12px;box-shadow:0 18px 45px rgba(11,44,107,.08)}h1{margin:0 0 16px;color:#0b2c6b;font-size:26px}p{line-height:1.7;color:#52647c}button{margin-top:16px;border:0;border-radius:7px;background:#0b2c6b;color:#fff;padding:14px 20px;font-weight:700;cursor:pointer}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}</main></body></html>`;
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { ...RESPONSE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function suppress(email: string, req: NextRequest) {
  const db = createServerSupabase();
  const { error } = await db.from("email_suppressions").upsert(
    {
      email,
      reason: "unsubscribe",
      source: "recipient",
      metadata: {
        unsubscribedAt: new Date().toISOString(),
        userAgent: (req.headers.get("user-agent") || "unknown").slice(0, 300),
      },
    },
    { onConflict: "email", ignoreDuplicates: false },
  );
  if (error) throw new Error(error.message);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return htmlResponse(page("Tautan tidak valid", "Tautan unsubscribe tidak valid atau sudah kedaluwarsa."), 400);
  }

  const action = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return htmlResponse(page(
    "Konfirmasi unsubscribe",
    `Konfirmasikan bahwa ${maskEmail(email)} tidak ingin menerima email follow-up BinaHub lagi. Email hasil assessment atau dokumen yang Anda minta tetap dapat dikirim.`,
    action,
  ));
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const email = verifyUnsubscribeToken(token);
  if (!email) {
    return htmlResponse(page("Tautan tidak valid", "Tautan unsubscribe tidak valid atau sudah kedaluwarsa."), 400);
  }

  try {
    await suppress(email, req);
    return htmlResponse(page(
      "Preferensi tersimpan",
      `${maskEmail(email)} tidak akan menerima email follow-up otomatis BinaHub lagi.`,
    ));
  } catch (error) {
    console.error("[Unsubscribe API] Failed to persist suppression:", error);
    return htmlResponse(page("Belum berhasil", "Preferensi belum dapat disimpan. Silakan coba kembali beberapa saat lagi."), 503);
  }
}
