import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function opaqueTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashOpaqueToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function proposalSecret() {
  const secret = process.env.PROPOSAL_LINK_SECRET;
  if (!secret) throw new Error("PROPOSAL_LINK_SECRET belum dikonfigurasi.");
  return secret;
}

export function createProposalToken(assessmentId: string, ttlSeconds = 60 * 60 * 24 * 30) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createHmac("sha256", proposalSecret())
    .update(`${assessmentId}:${expiresAt}`)
    .digest("base64url");
  return `${expiresAt}.${signature}`;
}

export function verifyProposalToken(assessmentId: string, token: string) {
  const [rawExpiry, rawSignature, extra] = token.split(".");
  const expiresAt = Number(rawExpiry);
  if (extra || !rawExpiry || !rawSignature || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = createHmac("sha256", proposalSecret())
    .update(`${assessmentId}:${expiresAt}`)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(rawSignature, "base64url");
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
