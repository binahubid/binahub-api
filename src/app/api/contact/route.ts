import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { corsHeadersFromRequest } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AttributionSchema } from "@/lib/validations";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM && process.env.EMAIL_FROM.includes("@")
  ? process.env.EMAIL_FROM
  : "onboarding@resend.dev";
const COMPANY_COPY = process.env.EMAIL_COMPANY_COPY || "admin@binahub.id";
const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || "BinaHub";

const ContactInquirySchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  company: z.string().trim().min(1, "Nama organisasi wajib diisi").max(300),
  role: z.string().trim().min(1, "Jabatan wajib diisi").max(200),
  email: z.string().trim().toLowerCase().email("Format email tidak valid").max(320),
  whatsapp: z.string().max(50).optional().default(""),
  message: z.string().trim().min(20, "Pesan minimal terdiri dari 20 karakter").max(5000),
  moduleCodes: z.array(z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/)).max(20).optional().default([]),
  attribution: AttributionSchema.optional().default({}),
  locale: z.enum(["id", "en"]).optional().default("id"),
}).strict();

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 300);
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFromRequest(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeadersFromRequest(req);
  let isEnglish = false;

  try {
    const rateLimited = await enforceRateLimit(req, "contact", 5, 60 * 60);
    if (rateLimited) {
      for (const [key, value] of Object.entries(headers)) rateLimited.headers.set(key, value);
      return rateLimited;
    }
    const rawBody = await req.json();
    isEnglish = rawBody?.locale === "en";

    const validationResult = ContactInquirySchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: isEnglish ? "Form validation failed" : "Validasi form gagal",
          details: validationResult.error.format(),
        },
        { status: 400, headers },
      );
    }

    const { name, company, role, email, whatsapp, message, attribution, moduleCodes } = validationResult.data;
    const supabase = createServerSupabase();

    let moduleRequestData: Record<string, unknown> = {};
    if (moduleCodes.length > 0) {
      const uniqueCodes = [...new Set(moduleCodes)];
      const { data: requestedModules, error: catalogError } = await supabase
        .from("catalog_modules")
        .select("id, module_code, name, standard_scope, pricing_unit, base_price, currency, catalog_version")
        .in("module_code", uniqueCodes)
        .eq("active", true)
        .eq("is_mock", false)
        .eq("readiness_status", "ready");
      if (catalogError || !requestedModules || requestedModules.length !== uniqueCodes.length) {
        return NextResponse.json(
          {
            success: false,
            error: isEnglish
              ? "One or more selected modules are no longer available. Please refresh the catalog."
              : "Satu atau lebih modul yang dipilih sudah tidak tersedia. Silakan muat ulang katalog.",
          },
          { status: 409, headers },
        );
      }
      moduleRequestData = {
        requestedAt: new Date().toISOString(),
        modules: requestedModules.map((item) => ({
          id: item.id,
          code: item.module_code,
          name: item.name,
          standardScope: item.standard_scope,
          pricingUnit: item.pricing_unit,
          basePrice: Number(item.base_price || 0),
          currency: item.currency,
          catalogVersion: item.catalog_version,
        })),
      };
    }

    const leadPayload = {
      name,
      email,
      company,
      phone: whatsapp || "",
      source: "contact_form",
      last_meaningful_activity_at: new Date().toISOString(),
      ...(Object.keys(attribution).length > 0 ? { source_metadata: attribution } : {}),
    };
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .upsert(leadPayload, { onConflict: "email", ignoreDuplicates: false })
      .select("id")
      .single();

    if (leadError || !lead) {
      console.error("[Contact API Error] Lead persistence failed:", leadError);
      return NextResponse.json(
        {
          success: false,
          error: isEnglish
            ? "Your inquiry could not be saved. Please try again shortly."
            : "Inquiry belum dapat disimpan. Silakan coba beberapa saat lagi.",
        },
        { status: 503, headers },
      );
    }

    const { error: inquiryError } = await supabase.from("inquiries").insert({
      lead_id: lead.id,
      name,
      company,
      email,
      whatsapp,
      role_title: role,
      message: `Organisasi: ${company}\nJabatan: ${role}\n\n${message}`,
      source: moduleCodes.length > 0 ? "module_catalog" : "contact_form",
      module_request_data: moduleRequestData,
      status: "Baru",
    });

    if (inquiryError) {
      console.error("[Contact API Error] Inquiry persistence failed:", inquiryError.message);
      return NextResponse.json(
        {
          success: false,
          error: isEnglish
            ? "Your inquiry could not be saved. Please try again shortly."
            : "Inquiry belum dapat disimpan. Silakan coba beberapa saat lagi.",
        },
        { status: 503, headers },
      );
    }

    const safe = {
      name: escapeHtml(name),
      company: escapeHtml(company),
      role: escapeHtml(role),
      email: escapeHtml(email),
      whatsapp: escapeHtml(whatsapp || "-"),
      message: escapeHtml(message).replace(/\n/g, "<br />"),
      modules: moduleCodes.length > 0 ? escapeHtml(moduleCodes.join(", ")) : "-",
    };

    let notificationDelayed = false;
    try {
      await resend.emails.send({
        from: `${COMPANY_NAME} <${FROM}>`,
        to: COMPANY_COPY,
        subject: safeHeader(`[INQUIRY BARU] ${company} - ${name}`),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0B1F3A;">
            <div style="background:#0B2C6B;color:#fff;padding:28px;border-radius:14px 14px 0 0;">
              <h1 style="margin:0;font-size:22px;">Pesan Kontak Baru Masuk</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,.72);">${COMPANY_NAME} Website</p>
            </div>
            <div style="border:1px solid #E5E7EB;border-top:0;padding:28px;border-radius:0 0 14px 14px;">
              <p><strong>Nama:</strong> ${safe.name}</p>
              <p><strong>Organisasi:</strong> ${safe.company}</p>
              <p><strong>Jabatan:</strong> ${safe.role}</p>
              <p><strong>Email:</strong> <a href="mailto:${safe.email}">${safe.email}</a></p>
              <p><strong>WhatsApp:</strong> ${safe.whatsapp}</p>
              <p><strong>Modul dipilih:</strong> ${safe.modules}</p>
              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />
              <p style="line-height:1.7;">${safe.message}</p>
            </div>
          </div>
        `,
      });
    } catch (error) {
      notificationDelayed = true;
      console.error("[Contact API Error] Resend email failed:", getErrorMessage(error));
    }

    return NextResponse.json(
      {
        success: true,
        notificationDelayed,
        message: isEnglish
          ? "Your inquiry has been sent successfully. Our team will contact you shortly."
          : "Inquiry Anda berhasil terkirim. Tim kami akan segera menghubungi Anda.",
      },
      { headers },
    );
  } catch (error: unknown) {
    console.error("[Contact API Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: isEnglish ? "An internal server error occurred." : "Terjadi kesalahan internal server.",
      },
      { status: 500, headers },
    );
  }
}
