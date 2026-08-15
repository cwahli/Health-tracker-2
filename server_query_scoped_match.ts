/**
 * A component may only bind to rows the resolver/search produced for *that* query.
 * Shared databaseMatchesArray leakage is how chicken stole onion-powder 171327.
 */

export function normalizeMatchQuery(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rowBelongsToQuery(query: string, row: { searchQuery?: string | null }, extraQueries: string[] = []): boolean {
  const tagged = normalizeMatchQuery(row?.searchQuery);
  if (!tagged) return false;
  const keys = [query, ...extraQueries].map(normalizeMatchQuery).filter(Boolean);
  return keys.some((k) => k === tagged || k.includes(tagged) || tagged.includes(k));
}

export function pickQueryScopedMatch<T extends { searchQuery?: string | null; source?: string; id?: string }>(
  query: string,
  matches: T[],
  extraQueries: string[] = []
): T | null {
  if (!query || !Array.isArray(matches)) return null;
  const scoped = matches.filter((m) => {
    if (!rowBelongsToQuery(query, m, extraQueries)) return false;
    if (m.source === 'category_fallback' || String(m.id || '').startsWith('fallback_')) return false;
    if (m.source === 'estimated' || m.source === 'canonical_dict') return false;
    return true;
  });
  if (scoped.length === 0) return null;
  const prefer = (src: string) => scoped.find((m) => m.source === src);
  return prefer('usda') || prefer('internal_catalog') || prefer('off') || prefer('brand_official') || scoped[0];
}

/** Restrict a shared pool to this component's own search rows. */
export function filterMatchesForQuery<T extends { searchQuery?: string | null }>(
  query: string,
  matches: T[],
  extraQueries: string[] = []
): T[] {
  return (matches || []).filter((m) => rowBelongsToQuery(query, m, extraQueries));
}
