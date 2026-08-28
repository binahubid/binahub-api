import type { NextRequest } from "next/server";

const allowedOrigins = new Set([
  "https://binahub.id",
  "https://www.binahub.id",
  "https://app.binahub.id",
  "https://api.binahub.id",
  "https://app-binahub.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3100",
]);

export function getCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "https://binahub.id";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function corsHeadersFromRequest(request: NextRequest) {
  return getCorsHeaders(request.headers.get("origin"));
}
