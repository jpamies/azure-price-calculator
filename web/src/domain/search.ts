// Fuzzy-ish search helpers shared by the VM SKU picker and the generic meter picker.

/** Lowercase, strip "Standard_" prefixes, "_" and "-" → space, collapse spaces. */
export function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\bstandard_/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function queryTokens(query: string): string[] {
  const q = normalize(query);
  return q ? q.split(" ") : [];
}

/** Every query token occurs (as a substring) in the haystack. Empty query → true. */
export function tokenMatch(haystack: string | readonly string[], query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const h = normalize(typeof haystack === "string" ? haystack : haystack.join(" "));
  return tokens.every((t) => h.includes(t));
}

function fieldScore(field: string, q: string, tokens: string[]): number {
  const f = normalize(field);
  if (!f) return 0;
  if (f === q) return 1000;
  const lengthPenalty = Math.min(50, (f.length - q.length) * 0.5);
  if (f.startsWith(q)) return 800 - lengthPenalty;
  if (!tokens.every((t) => f.includes(t))) return 0;
  const words = f.split(" ");
  let s = 300;
  if (f.includes(q)) s += 150;
  for (const t of tokens) {
    if (words.includes(t)) s += 40;
    else if (words.some((w) => w.startsWith(t))) s += 20;
  }
  return s - lengthPenalty;
}

/**
 * Relevance of `fields` for `query` (higher = better, 0 = no match). Exact normalized match 1000,
 * prefix ~800, all tokens in one field ~300-500, tokens spread over fields 100. Empty query → 1.
 */
export function score(fields: string | readonly string[], query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const tokens = q.split(" ");
  const list = typeof fields === "string" ? [fields] : fields;
  let best = 0;
  for (const f of list) best = Math.max(best, fieldScore(f, q, tokens));
  if (best === 0 && tokenMatch(list, query)) best = 100;
  return best;
}

/** Items matching `query`, best first (stable for equal scores). Empty query → items unchanged. */
export function rankBy<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => string | readonly string[],
  limit?: number,
): T[] {
  if (!normalize(query)) return limit === undefined ? [...items] : items.slice(0, limit);
  const scored: { item: T; s: number; i: number }[] = [];
  items.forEach((item, i) => {
    const s = score(fields(item), query);
    if (s > 0) scored.push({ item, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const out = scored.map((x) => x.item);
  return limit === undefined ? out : out.slice(0, limit);
}
