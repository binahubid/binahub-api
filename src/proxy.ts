import { NextResponse, type NextRequest } from "next/server";
import { corsHeadersFromRequest } from "@/lib/cors";

export function proxy(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
