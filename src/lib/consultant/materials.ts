import tutorials from "./tutorials.json";
import { createServerSupabase } from "@/lib/supabase";

export const consultantDocuments = [
  {
    slug: "company-profile",
    title: "Company Profile BinaHub",
    description: "Profil perusahaan, pendekatan 4A, tiga pilar, dan ekosistem BinaHub.",
    filename: "BinaHub-company-profile-v3.pdf",
    storageName: "company-profile-binahub-v3.pdf",
  },
  {
    slug: "product-knowledge",
    title: "Product Knowledge BinaHub",
    description: "Panduan layanan BinaHub dan 32 program Signature Solutions.",
    filename: "BinaHub-product-knowledge-v3.pdf",
    storageName: "product-knowledge-binahub-v3.pdf",
  },
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
