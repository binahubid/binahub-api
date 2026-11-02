import { randomBytes } from "node:crypto";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function withoutAISecrets(value: string) {
  return value
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+\/-]+=*/gi, "[CREDENTIAL_REMOVED]")
    .replace(
      /\b(?:sk-|sk_|cc_|re_)[A-Za-z0-9_-]{16,}\b/g,
      "[CREDENTIAL_REMOVED]",
    )
    .replace(
      /\b(?:api[_ -]?key|password|secret|token)(?:\\*["'])?\s*[:=]\s*(?:\\*["'])?[^\\\s,"';}<>]+/gi,
      "[CREDENTIAL_REMOVED]",
    );
}

/** Request-local pseudonyms, not anonymization. No map is logged or persisted. */
export class AIPrivacyBoundary {
  private readonly prefix =
    "__BH_PRIVATE_" + randomBytes(8).toString("hex") + "_";
  private readonly aliases = new Map<string, string>();
  constructor(
    private readonly identities: readonly (string | null | undefined)[] = [],
  ) {}
  private alias(value: string) {
    let token = this.aliases.get(value);
    if (!token) {
      token = this.prefix + (this.aliases.size + 1) + "__";
      this.aliases.set(value, token);
    }
    return token;
  }
  protect(value: string) {
    let text = withoutAISecrets(value);
    for (const identity of [
      ...new Set(
        this.identities.filter(
          (v): v is string => typeof v === "string" && v.trim().length >= 2,
        ),
      ),
    ].sort((a, b) => b.length - a.length)) {
      for (const form of new Set([
        JSON.stringify(identity).slice(1, -1),
        identity,
      ])) {
        text = text.replace(
          new RegExp(
            "(?<![\\p{L}\\p{N}])" + escape(form) + "(?![\\p{L}\\p{N}])",
            "giu",
          ),
          (match) => this.alias(form === identity ? match : identity),
        );
      }
    }
    return text
      .replace(/[\p{L}\p{N}_.%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, (match) =>
        this.alias(match),
      )
      .replace(/\bhttps?:\/\/[^\s<>"'\\]+/gi, () => "[PRIVATE_URL_REMOVED]")
      .replace(
        /(?<![\p{L}\p{N}_])\+?\d(?:[ \t().-]*\d){8,}(?![\p{L}\p{N}_])/gu,
        (match) => this.alias(match),
      );
  }
  restore(value: string) {
    let text = value;
    // One pass only: user input cannot recursively expand another private token.
    const byToken = new Map(
      [...this.aliases].map(([original, token]) => [token, original]),
    );
    text = text.replace(
      new RegExp(escape(this.prefix) + "\\d+__", "g"),
      (token) => byToken.get(token) ?? token,
    );
    return text;
  }
  restoreContent(content: string) {
    const trimmed = content.trim();
    const json = trimmed
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?\s*```$/, "")
      .trim();
    if (
      (json.startsWith("{") && json.endsWith("}")) ||
      (json.startsWith("[") && json.endsWith("]"))
    ) {
      try {
        const restoreValue = (value: unknown): unknown =>
          typeof value === "string"
            ? this.restore(value)
            : Array.isArray(value)
              ? value.map(restoreValue)
              : value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).map(([key, item]) => [
                      key,
                      restoreValue(item),
                    ]),
                  )
                : value;
        return JSON.stringify(restoreValue(JSON.parse(json)));
      } catch {
        /* Invalid model JSON still follows the caller's existing failure path. */
      }
    }
    return this.restore(content);
  }
}

export const AI_PRIVATE_REFERENCE_INSTRUCTION =
  "Penanda __BH_PRIVATE_ adalah referensi privat. Jika diperlukan pada hasil, salin penandanya persis tanpa menebak atau mengubahnya; sistem akan melakukan personalisasi lokal. Jangan membuat identitas/kontak baru.";
