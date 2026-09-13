import { NextResponse } from "next/server";
import packageMetadata from "../../../../package.json";

export const dynamic = "force-dynamic";

export function GET() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null;

  return NextResponse.json({
    status: "ok",
    service: "binahub-api",
    version: packageMetadata.version,
    revision: revision ? revision.slice(0, 12) : null,
    observability: {
      provider: "supabase",
      verificationEndpoint: "/api/admin/observability",
    },
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
