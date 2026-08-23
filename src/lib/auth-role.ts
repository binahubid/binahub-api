import { NextRequest } from "next/server";
import { User } from "@supabase/supabase-js";
import { supabase, createServerSupabase } from "./supabase";

export type AppRole = "admin" | "facilitator" | "client" | "peserta";

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

export function getBearerToken(authorization: string | null | undefined) {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export async function getUserFromBearer(req: NextRequest): Promise<
  | {
      token: string;
      user: User;
    }
  | AuthError
> {
  const token = getBearerToken(req.headers.get("authorization"));

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
      user.app_metadata?.app_role ??
      "",
  )
    .trim()
    .toLowerCase();

  if (role === "admin" || role === "facilitator" || role === "client" || role === "peserta") {
    return role;
  }

  return null;
}

export async function getAuthoritativeUserRole(user: User): Promise<AppRole | null> {
  const { data, error } = await createServerSupabase()
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memverifikasi role pengguna: ${error.message}`);
  }

  if (isAdminFallbackEmail(user.email)) return "admin";
  if (isFacilitatorFallbackEmail(user.email)) return "facilitator";

  const storedRole = String(data?.role || "").trim().toLowerCase();
  if (storedRole === "admin" || storedRole === "facilitator" || storedRole === "client" || storedRole === "peserta") {
    return storedRole;
  }

  // Trusted app_metadata is only a bootstrap fallback before a profile exists.
  return data ? null : getUserRole(user);
}

export function isAdminFallbackEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  return readEmailAllowlist(process.env.ADMIN_EMAILS).has(normalizedEmail);
}

export function isFacilitatorFallbackEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return false;
  }

  return readEmailAllowlist(process.env.FACILITATOR_EMAILS).has(normalizedEmail);
}
