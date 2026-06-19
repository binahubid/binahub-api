import { NextResponse } from "next/server";
import { clientAccessCookie } from "@/lib/client-access";

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(clientAccessCookie, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
