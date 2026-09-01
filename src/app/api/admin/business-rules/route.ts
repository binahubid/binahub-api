import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { catalogModuleMutationSchema } from "@/lib/admin-mutation-schemas";
import { applyCommercialPolicy, normalizeProposalRules } from "@/lib/proposal-policy";
import { createServerSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [{ data: ruleSets, error: rulesError }, { data: products, error: productsError }, { data: modules, error: modulesError }, { data: commercialPolicy, error: commercialError }] = await Promise.all([
    db.from("business_rule_sets").select("id, version, status, is_mock, rules, effective_at, approved_by, approved_at, created_at, updated_at").order("created_at", { ascending: false }),
    db.from("catalog_products").select("id, product_key, name, status, objective, notes, created_at, updated_at").order("name", { ascending: true }),
    db.from("catalog_modules").select("id, product_id, module_code, name, description, standard_scope, pricing_unit, base_price, currency, readiness_status, is_mock, active, catalog_version, metadata, created_at, updated_at").order("name", { ascending: true }),
    db.from("commercial_policy_settings").select("*").eq("setting_key", "default").maybeSingle(),
  ]);

  const error = rulesError || productsError || modulesError || commercialError;
  if (error) return adminError(error.message, 500, "BUSINESS_RULES_READ_FAILED");

  const selectedRuleSet = ruleSets?.find((item) => item.status === "active")
    || ruleSets?.find((item) => item.status === "mock")
    || ruleSets?.[0]
    || null;

  return NextResponse.json({
    success: true,
    selectedRuleSet,
    normalizedRules: applyCommercialPolicy(normalizeProposalRules(selectedRuleSet), commercialPolicy),
    commercialPolicy,
    ruleSets: ruleSets || [],
    products: products || [],
    modules: modules || [],
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, catalogModuleMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_CATALOG_MODULE");

  const moduleInput = parsed.data;
  const payload = {
    product_id: moduleInput.productId,
    module_code: moduleInput.moduleCode,
    name: moduleInput.name,
    description: moduleInput.description || null,
    standard_scope: moduleInput.standardScope || null,
    pricing_unit: moduleInput.pricingUnit,
    base_price: moduleInput.basePrice,
    currency: moduleInput.currency,
    readiness_status: moduleInput.readinessStatus,
    is_mock: moduleInput.isMock,
    active: moduleInput.active,
    catalog_version: moduleInput.catalogVersion,
  };
  const db = createServerSupabase();
  const query = moduleInput.id
    ? db.from("catalog_modules").update(payload).eq("id", moduleInput.id).select().single()
    : db.from("catalog_modules").insert(payload).select().single();
  const { data, error } = await query;
  if (error) return adminError(error.message, 500, "CATALOG_MODULE_SAVE_FAILED");

  await logAdminEvent(db, {
    eventType: moduleInput.id ? "catalog_module_updated" : "catalog_module_created",
    targetType: "catalog_module",
    targetId: data.id,
    actor: admin.email,
    payload: { moduleCode: data.module_code, catalogVersion: data.catalog_version, isMock: data.is_mock },
    status: "Saved",
    message: `Modul katalog ${data.module_code} disimpan oleh ${admin.email}.`,
  });

  return NextResponse.json({ success: true, module: data });
}
