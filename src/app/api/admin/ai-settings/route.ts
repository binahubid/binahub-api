import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { AI_PROVIDERS, aiRoutingPolicySchema, providerConfigured } from "@/lib/ai-routing-policy";
import { effectiveAIRoutingPolicy, readAIProviderSettings } from "@/lib/ai-provider-settings";
import { buildAIProviderAttempts } from "@/lib/ai-provider";

const headers = { "Cache-Control": "no-store" };
const schema = z.object({ policy: aiRoutingPolicySchema, version: z.number().int().min(0) }).strict();
function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers });
}
async function snapshot(committed?: Awaited<ReturnType<typeof readAIProviderSettings>>) {
  const settings = committed || await readAIProviderSettings();
  const policy = effectiveAIRoutingPolicy(settings.policy);
  // Only non-secret metadata crosses the admin boundary; availability is not a health check.
  const attempts = buildAIProviderAttempts(process.env, "general", {
    primaryProvider: "lapakvip", enabledProviders: [...AI_PROVIDERS],
  });
  return { ...settings, policy, providers: AI_PROVIDERS.map((id) => ({
    id, configured: providerConfigured(id), model: attempts.find((item) => item.provider === id)?.model || null,
  })) };
}
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return failure(admin.error || "Akses admin tidak tersedia.", admin.status || 401);
  try { return NextResponse.json({ success: true, ...await snapshot() }, { headers }); }
  catch { return failure("Pengaturan AI belum dapat dimuat. Silakan coba lagi.", 503); }
}
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return failure(admin.error || "Akses admin tidak tersedia.", admin.status || 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failure("Pilih satu provider utama yang aktif dan periksa pilihan cadangan.", 400);
  if (parsed.data.policy.enabledProviders.some((id) => !providerConfigured(id))) {
    return failure("API key provider yang dipilih belum tersedia di server API.", 400);
  }
  try {
    const { policy, version } = parsed.data;
    const { data, error } = await createServerSupabase().rpc("save_ai_provider_settings", {
      p_primary: policy.primaryProvider, p_enabled: policy.enabledProviders, p_version: version, p_actor: admin.userId,
    });
    if (error) {
      if (error.message.includes("AI_SETTINGS_CONFLICT")) return failure("Pengaturan diubah admin lain. Muat ulang lalu pilih kembali.", 409);
      if (["42883", "PGRST202"].includes(error.code)) return failure("Jalankan SQL 68 terlebih dahulu untuk menyimpan pengaturan AI.", 503);
      return failure("Pengaturan AI belum tersimpan. Silakan coba lagi.", 503);
    }
    return NextResponse.json({ success: true, ...await snapshot({ policy, version: data.version,
      updatedAt: data.updated_at, setupRequired: false }) }, { headers });
  } catch { return failure("Pengaturan AI belum tersimpan. Silakan coba lagi.", 503); }
}
