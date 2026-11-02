import { z } from 'zod';

export const SPIN_INBOX_PAGE_SIZE = 20;
export const SpinInboxQuerySchema = z.object({
  page: z.coerce.number().int().min(0).max(10000),
  search: z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/),
});

/** Literal, case-insensitive contact search. Never interpolate filter syntax or a user regex. */
export function spinContactSearchFilter(search: string) {
  const literal = search.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  // Quote once for PostgREST's logical-filter grammar; the client URL-encodes it.
  const value = JSON.stringify(literal);
  return ['name', 'company', 'email'].map((field) => `contact->>${field}.imatch.${value}`).join(',');
}
