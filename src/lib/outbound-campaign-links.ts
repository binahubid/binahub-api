import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "bh20";
const TOKEN_PATTERN = /^bh20\.([A-Za-z0-9_-]{32,96})\.([A-Za-z0-9_-]{40,96})$/;

function secret() {
  return process.env.ACQUISITION_LINK_SECRET?.trim() || "";
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function sign(nonce: string, key: string) {
  return encode(createHmac("sha256", key).update(`${TOKEN_PREFIX}.${nonce}`).digest());
}

export function outboundLinkSigningReady() {
  return secret().length >= 32;
}

/** The opaque token carries no campaign, prospect, lead, or email identifier. */
export function createOutboundCampaignToken() {
  const key = secret();
  if (key.length < 32) throw new Error("ACQUISITION_LINK_SECRET belum tersedia atau terlalu pendek.");
  const nonce = encode(randomBytes(32));
  return `${TOKEN_PREFIX}.${nonce}.${sign(nonce, key)}`;
}

export function verifyOutboundCampaignToken(token: string) {
  const key = secret();
  const match = TOKEN_PATTERN.exec(token);
  if (key.length < 32 || !match) return false;
  const expected = Buffer.from(sign(match[1], key));
  const received = Buffer.from(match[2]);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function outboundCampaignTokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function publicWebsiteOrigin() {
  const raw = process.env.PUBLIC_WEBSITE_URL?.trim() || "https://binahub.id";
  try { return new URL(raw).origin; } catch { return "https://binahub.id"; }
}
