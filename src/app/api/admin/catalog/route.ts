import { NextRequest, NextResponse } from "next/server";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { catalogAdminMutationSchema } from "@/lib/configurable-business-schemas";
import { createServerSupabase } from "@/lib/supabase";

const PRODUCT_FIELDS = [
  "id",
  "product_key",
  "slug",
  "name",
  "status",
  "objective",
  "notes",
  "short_description",
  "public_description",
  "cover_image_url",
  "public_visible",
  "featured",
  "display_order",
  "published_at",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
].join(",");

const MODULE_FIELDS = [
  "id",
  "product_id",
  "module_code",
  "slug",
  "name",
  "description",
  "standard_scope",
  "deliverables",
  "out_of_scope",
  "pricing_unit",
  "base_price",
  "minimum_quantity",
  "currency",
  "duration_label",
  "readiness_status",
  "is_mock",
  "active",
  "public_visible",
  "featured",
  "display_order",
  "catalog_version",
  "metadata",
  "published_at",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
].join(",");

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [{ data: products, error: productsError }, { data: modules, error: modulesError }] = await Promise.all([
    db.from("catalog_products").select(PRODUCT_FIELDS).order("display_order").order("name"),
    db.from("catalog_modules").select(MODULE_FIELDS).order("display_order").order("name"),
  ]);

  const error = productsError || modulesError;
  if (error) return adminError(error.message, 500, "CATALOG_LOAD_FAILED");
  return NextResponse.json({ success: true, products: products || [], modules: modules || [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, catalogAdminMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_CATALOG_MUTATION");

  const db = createServerSupabase();
  const input = parsed.data;

  if (input.action === "save_product") {
    const product = input.product;
    const payload = {
      product_key: product.productKey,
      slug: product.slug,
      name: product.name,
      status: product.status,
      objective: product.objective || null,
      notes: product.notes || null,
      short_description: product.shortDescription || null,
      public_description: product.publicDescription || null,
      cover_image_url: product.coverImageUrl || null,
      public_visible: product.publicVisible,
      featured: product.featured,
      display_order: product.displayOrder,
      published_at: product.publicVisible ? new Date().toISOString() : null,
      updated_by: admin.email,
      ...(!product.id ? { created_by: admin.email } : {}),
    };
    const query = product.id
      ? db.from("catalog_products").update(payload).eq("id", product.id).select().single()
      : db.from("catalog_products").insert(payload).select().single();
    const { data, error } = await query;
    if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "CATALOG_PRODUCT_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: product.id ? "catalog_product_updated" : "catalog_product_created",
      targetType: "catalog_product",
      targetId: data.id,
      actor: admin.email,
      payload: { productKey: data.product_key, status: data.status, publicVisible: data.public_visible },
      status: "Saved",
      message: `Produk ${data.name} disimpan oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, product: data });
  }

  if (input.action === "save_module") {
    const catalogModule = input.module;
    const payload = {
      product_id: catalogModule.productId,
      module_code: catalogModule.moduleCode,
      slug: catalogModule.slug,
      name: catalogModule.name,
      description: catalogModule.description || null,
      standard_scope: catalogModule.standardScope || null,
      deliverables: catalogModule.deliverables || null,
      out_of_scope: catalogModule.outOfScope || null,
      pricing_unit: catalogModule.pricingUnit,
      base_price: catalogModule.basePrice,
      minimum_quantity: catalogModule.minimumQuantity,
      currency: catalogModule.currency,
      duration_label: catalogModule.durationLabel || null,
      readiness_status: catalogModule.readinessStatus,
      is_mock: catalogModule.isMock,
      active: catalogModule.active,
      public_visible: catalogModule.publicVisible,
      featured: catalogModule.featured,
      display_order: catalogModule.displayOrder,
      catalog_version: catalogModule.catalogVersion,
      published_at: catalogModule.publicVisible ? new Date().toISOString() : null,
      updated_by: admin.email,
      ...(!catalogModule.id ? { created_by: admin.email } : {}),
    };
    const query = catalogModule.id
      ? db.from("catalog_modules").update(payload).eq("id", catalogModule.id).select().single()
      : db.from("catalog_modules").insert(payload).select().single();
    const { data, error } = await query;
    if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "CATALOG_MODULE_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: catalogModule.id ? "catalog_module_updated" : "catalog_module_created",
      targetType: "catalog_module",
      targetId: data.id,
      actor: admin.email,
      payload: {
        moduleCode: data.module_code,
        catalogVersion: data.catalog_version,
        publicVisible: data.public_visible,
        isMock: data.is_mock,
      },
      status: "Saved",
      message: `Modul ${data.name} disimpan oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, module: data });
  }

  if (input.action === "delete_product") {
    const { count, error: countError } = await db
      .from("catalog_modules")
      .select("id", { count: "exact", head: true })
      .eq("product_id", input.id);
    if (countError) return adminError(countError.message, 500, "CATALOG_PRODUCT_DELETE_CHECK_FAILED");
    if ((count || 0) > 0) {
      return adminError(
        "Produk masih memiliki modul. Hapus atau pindahkan modul terlebih dahulu.",
        409,
        "CATALOG_PRODUCT_HAS_MODULES",
      );
    }

    const { data, error } = await db.from("catalog_products").delete().eq("id", input.id).select("id, name").maybeSingle();
    if (error) return adminError(error.message, 500, "CATALOG_PRODUCT_DELETE_FAILED");
    if (!data) return adminError("Produk tidak ditemukan.", 404, "CATALOG_PRODUCT_NOT_FOUND");
    await logAdminEvent(db, {
      eventType: "catalog_product_deleted",
      targetType: "catalog_product",
      targetId: data.id,
      actor: admin.email,
      status: "Deleted",
      message: `Produk ${data.name} dihapus oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, deletedId: data.id });
  }

  const { data: existing, error: existingError } = await db
    .from("catalog_modules")
    .select("id, name, module_code, public_visible, readiness_status")
    .eq("id", input.id)
    .maybeSingle();
  if (existingError) return adminError(existingError.message, 500, "CATALOG_MODULE_DELETE_CHECK_FAILED");
  if (!existing) return adminError("Modul tidak ditemukan.", 404, "CATALOG_MODULE_NOT_FOUND");

  if (existing.public_visible || existing.readiness_status === "ready") {
    const { error } = await db
      .from("catalog_modules")
      .update({
        active: false,
        public_visible: false,
        readiness_status: "retired",
        updated_by: admin.email,
      })
      .eq("id", input.id);
    if (error) return adminError(error.message, 500, "CATALOG_MODULE_ARCHIVE_FAILED");
    await logAdminEvent(db, {
      eventType: "catalog_module_archived",
      targetType: "catalog_module",
      targetId: existing.id,
      actor: admin.email,
      status: "Archived",
      message: `Modul ${existing.name} diarsipkan agar histori komersial tetap terjaga.`,
    });
    return NextResponse.json({ success: true, archivedId: existing.id, disposition: "archived" });
  }

  const { error } = await db.from("catalog_modules").delete().eq("id", input.id);
  if (error) return adminError(error.message, 500, "CATALOG_MODULE_DELETE_FAILED");
  await logAdminEvent(db, {
    eventType: "catalog_module_deleted",
    targetType: "catalog_module",
    targetId: existing.id,
    actor: admin.email,
    status: "Deleted",
    message: `Modul ${existing.name} dihapus oleh ${admin.email}.`,
  });
  return NextResponse.json({ success: true, deletedId: existing.id, disposition: "deleted" });
}
