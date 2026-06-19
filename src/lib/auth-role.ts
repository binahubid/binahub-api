import { NextRequest } from "next/server";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "facilitator" | "client";

type AuthError = {
  error: string;
  status: 401 | 403;
};

export function readEmailAllowlist(value: string | undefined, fallback = "") {
  return new Set(
    (value || fallback)
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || "";
}

export async function getUserFromBearer(req: NextRequest): Promise<
  | {
      token: string;
      user: User;
    }
  | AuthError
> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return { error: "Token tidak ditemukan", status: 401 };
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { error: "Token tidak valid", status: 403 };
  }

  return { token, user: data.user };
}

export function getUserRole(user: User): AppRole | null {
  const role = String(
    user.app_metadata?.role ??
      user.user_metadata?.role ??
      user.app_metadata?.app_role ??
      user.user_metadata?.app_role ??
      "",
  )
    .trim()
    .toLowerCase();

  if (role === "admin" || role === "facilitator" || role === "client") {
    return role;
  }

  return null;
}

export function isAdminFallbackEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  return readEmailAllowlist(process.env.ADMIN_EMAILS, "admin@binahub.id").has(
    normalizedEmail,
  );
}

export function isFacilitatorFallbackEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  if (normalizedEmail === "facilitator@binahub.id" || normalizedEmail === "fasilitator@binahub.id") {
    return true;
  }

  return readEmailAllowlist(process.env.FACILITATOR_EMAILS).has(normalizedEmail);
}
