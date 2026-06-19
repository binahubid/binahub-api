import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const BUCKET = "associate-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "rtf", "txt"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
]);

function safeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const associateId = safeName(String(formData.get("associateId") || "new-associate"));

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "File CV tidak ditemukan." }, { status: 400 });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(extension) || (file.type && !ALLOWED_MIME_TYPES.has(file.type))) {
    return NextResponse.json(
      { success: false, error: "Format CV harus PDF, DOC, DOCX, RTF, atau TXT." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: "Ukuran CV maksimal 10 MB." }, { status: 400 });
  }

  const db = createServerSupabase();
  const path = `${associateId}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    path,
    bucket: BUCKET,
    filename: file.name,
    size: file.size,
    uploadedBy: admin.email,
  });
}
