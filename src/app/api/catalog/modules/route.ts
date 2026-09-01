import { NextRequest, NextResponse } from "next/server";
import { corsHeadersFromRequest } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { buildPublicCatalog } from "@/lib/public-catalog";
import { createServerSupabase } from "@/lib/supabase";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFromRequest(req) });
}

export async function GET(req: NextRequest) {
  const headers = corsHeadersFromRequest(req);
  const rateLimited = await enforceRateLimit(req, "public-catalog", 120, 60 * 60);
  if (rateLimited) {
    for (const [key, value] of Object.entries(headers)) rateLimited.headers.set(key, value);
    return rateLimited;
  }

  const db = createServerSupabase();
  const [{ data: products, error: productsError }, { data: modules, error: modulesError }] = await Promise.all([
    db.from("catalog_products")
      .select("id, product_key, slug, name, objective, short_description, public_description, cover_image_url, featured, display_order")
      .eq("status", "ready")
      .eq("public_visible", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
    db.from("catalog_modules")
      .select("id, product_id, module_code, slug, name, description, standard_scope, deliverables, out_of_scope, pricing_unit, base_price, minimum_quantity, currency, duration_label, featured, display_order, catalog_version")
      .eq("active", true)
      .eq("is_mock", false)
      .eq("readiness_status", "ready")
      .eq("public_visible", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  const error = productsError || modulesError;
  if (error) {
    console.error("[Public Catalog] Read failed:", error.message);
    return NextResponse.json(
      { success: false, error: "Katalog sementara belum tersedia." },
      { status: 503, headers },
    );
  }

  return NextResponse.json(
    {
      success: true,
      products: buildPublicCatalog(products || [], modules || []),
      policy: {
        onlyPublishedModules: true,
        mockDataExcluded: true,
        pricesExcludeTax: null,
        taxPolicyFinalized: false,
      },
    },
    { headers: { ...headers, "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
