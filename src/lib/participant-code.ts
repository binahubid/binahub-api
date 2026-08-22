import { createHash, randomInt } from "node:crypto";

const PARTICIPANT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeParticipantCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("BH") && compact.length === 10) {
    return `BH-${compact.slice(2, 6)}-${compact.slice(6)}`;
  }
  return value.trim().toUpperCase();
}

export function createParticipantCode() {
  const randomPart = Array.from({ length: 8 }, () => (
    PARTICIPANT_CODE_ALPHABET[randomInt(PARTICIPANT_CODE_ALPHABET.length)]
  )).join("");
  return `BH-${randomPart.slice(0, 4)}-${randomPart.slice(4)}`;
}

export function hashParticipantCode(value: string) {
  return createHash("sha256").update(normalizeParticipantCode(value)).digest("hex");
}

export function participantCodeHint(value: string) {
  return normalizeParticipantCode(value).slice(-4);
}
