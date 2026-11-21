import tutorials from "./tutorials.json";
import { createServerSupabase } from "@/lib/supabase";

export const consultantDocuments = [
  { slug: "company-profile-v1", title: "Company Profile BinaHub — Versi 1", description: "Profil perusahaan, pendekatan, tiga pilar, dan ekosistem BinaHub.", filename: "BinaHub-company-profile-v1.pdf", storageName: "company-profile-binahub-v1.pdf" },
  { slug: "company-profile", title: "Company Profile BinaHub — Versi 2", description: "Edisi futuristik dari profil perusahaan dan ekosistem BinaHub.", filename: "BinaHub-company-profile-v2.pdf", storageName: "company-profile-binahub.pdf" },
  { slug: "product-knowledge-v1", title: "Product Knowledge BinaHub — Versi 1", description: "Panduan produk dan 32 program Signature Solutions.", filename: "BinaHub-product-knowledge-v1.pdf", storageName: "product-knowledge-binahub-v1.pdf" },
  { slug: "product-knowledge", title: "Product Knowledge BinaHub — Versi 2", description: "Edisi futuristik dari panduan produk dan 32 program Signature Solutions.", filename: "BinaHub-product-knowledge-v2.pdf", storageName: "product-knowledge-binahub.pdf" },
] as const;

export const consultantTutorials = tutorials;

export function consultantMaterialCatalog() {
  return {
    documents: consultantDocuments.map(({ slug, title, description, filename }) => ({ slug, title, description, filename })),
    videos: consultantTutorials,
  };
}

export async function consultantDocumentLink(slug: string) {
  const document = consultantDocuments.find((item) => item.slug === slug);
  if (!document) return null;
  const { data, error } = await createServerSupabase().storage
    .from("consultant-materials").createSignedUrl(document.storageName, 120);
  if (error || !data?.signedUrl) throw new Error("MATERIAL_UNAVAILABLE");
  return { url: data.signedUrl, filename: document.filename, expiresInSeconds: 120 };
}
