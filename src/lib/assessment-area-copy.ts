// Presentation-only normalization, including archived AI narratives.
// Never rename dimension keys: persisted scores and API contracts stay compatible.
export function assessmentAreaText(text: string): string {
  return text.replace(/antardimensi/gi, 'antar area')
    .replace(/\b(dimensi|dimensions?|dimensional)\b/gi, (word) => {
      const replacement = word.toLowerCase() === 'dimensions' ? 'areas' : 'area';
      return word === word.toUpperCase() ? replacement.toUpperCase()
        : word[0] === word[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    });
}
export function assessmentAreaCopy<T>(value: T): T {
  if (typeof value === 'string') return assessmentAreaText(value) as T;
  if (Array.isArray(value)) return value.map(assessmentAreaCopy) as T;
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, assessmentAreaCopy(item)]),
  ) as T;
  return value;
}
