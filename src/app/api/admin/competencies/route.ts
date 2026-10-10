import { NextRequest, NextResponse } from "next/server";
import { adminError } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";

const FRAMEWORK_ID = "signature-2026-competency-v1";
const privateHeaders = { "Cache-Control": "private, no-store" };

// Read-only foundation. Nothing here activates competency scoring or recommendations.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  try {
    const db = createServerSupabase();
    const [framework, competencies, mappings] = await Promise.all([
      db.from("competency_frameworks").select("id,source_file,source_sha256,measurement_status")
        .eq("id", FRAMEWORK_ID).maybeSingle(),
      db.from("competency_dictionary")
        .select("code,name,definition,behavioral_indicators,kpi_source_version,content_status")
        .eq("framework_id", FRAMEWORK_ID).order("name"),
      db.from("catalog_module_competencies")
        .select("module_id,competency_code,role,display_order,source_solution_title,catalog_modules(module_code,active)")
        .eq("framework_id", FRAMEWORK_ID).order("display_order"),
    ]);
    const error = framework.error || competencies.error || mappings.error;
    if (error) {
      const missingSchema = ["42P01", "PGRST205"].includes(error.code || "");
      if (missingSchema) return NextResponse.json({ success: false, code: "COMPETENCY_SETUP_REQUIRED",
        error: "Kamus kompetensi belum terpasang. Tim teknis perlu menjalankan SQL 63." }, { status: 503, headers: privateHeaders });
      throw error;
    }
    if (!framework.data) return NextResponse.json({ success: false, code: "COMPETENCY_SETUP_REQUIRED",
      error: "Data kamus kompetensi belum tersedia. Tim teknis perlu memeriksa SQL 63." }, { status: 503, headers: privateHeaders });

    return NextResponse.json({ success: true, framework: framework.data,
      competencies: competencies.data || [], mappings: mappings.data || [],
      // Assessment activation is deliberately a separate release, even after KPI definitions arrive.
      assessmentIntegrationActive: false,
    }, { headers: privateHeaders });
  } catch (error) {
    console.error("[admin/competencies] Load failed", error);
    return NextResponse.json({ success: false, code: "COMPETENCY_LOAD_FAILED",
      error: "Kamus kompetensi belum dapat dimuat. Silakan coba lagi." }, { status: 500, headers: privateHeaders });
  }
}
