/** Presentation only: preserve submitted words; do not invent an AI summary. */
export function spinSummaryPoints(text:string):string[]{
 return [...new Set(text.split(/\s*·\s*|;\s*|\n+/).map(value=>value.trim().replace(/^[.;\s]+|[;\s]+$/g,'')).filter(Boolean))];
}
