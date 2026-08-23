import { NextResponse, type NextRequest } from "next/server";
import { corsHeadersFromRequest } from "@/lib/cors";

export function proxy(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);
  const apiSecurityHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: { ...corsHeaders, ...apiSecurityHeaders },
    });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries({ ...corsHeaders, ...apiSecurityHeaders })) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
