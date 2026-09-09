export function canonicalEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function assessmentRecipientEmail(formData: unknown) {
  if (!formData) return "";
  if (typeof formData === "string") {
    try {
      return assessmentRecipientEmail(JSON.parse(formData));
    } catch {
      return "";
    }
  }
  if (typeof formData !== "object" || Array.isArray(formData)) return "";
  return canonicalEmail((formData as Record<string, unknown>).email);
}

export function isPilotRecipientAllowed(allowedEmails: ReadonlySet<string>, value: unknown) {
  const email = canonicalEmail(value);
  return Boolean(email && allowedEmails.has(email));
}
