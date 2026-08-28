import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

export function normalizeRecipientEmail(email: string) {
  return email.trim().toLowerCase();
}

function unsubscribeSecret() {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("UNSUBSCRIBE_SECRET harus dikonfigurasi dengan minimal 32 karakter.");
  }
  return secret;
}

function signatureFor(email: string, expiresAt: number) {
  return createHmac("sha256", unsubscribeSecret())
    .update(`${email}:${expiresAt}`)
    .digest();
}

export function createUnsubscribeToken(email: string, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const normalizedEmail = normalizeRecipientEmail(email);
  if (!normalizedEmail || normalizedEmail.length > 320 || !normalizedEmail.includes("@")) {
    throw new Error("Alamat email unsubscribe tidak valid.");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const encodedEmail = Buffer.from(normalizedEmail, "utf8").toString("base64url");
  const signature = signatureFor(normalizedEmail, expiresAt).toString("base64url");
  return `${encodedEmail}.${expiresAt}.${signature}`;
}

export function verifyUnsubscribeToken(token: string) {
  const [encodedEmail, rawExpiry, rawSignature, extra] = token.split(".");
  const expiresAt = Number(rawExpiry);
  if (
    extra
    || !encodedEmail
    || !rawExpiry
    || !rawSignature
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  let email: string;
  let suppliedSignature: Buffer;
  try {
    email = normalizeRecipientEmail(Buffer.from(encodedEmail, "base64url").toString("utf8"));
    suppliedSignature = Buffer.from(rawSignature, "base64url");
  } catch {
    return null;
  }

  if (!email || email.length > 320 || !email.includes("@")) return null;
  const expectedSignature = signatureFor(email, expiresAt);
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  return email;
}
