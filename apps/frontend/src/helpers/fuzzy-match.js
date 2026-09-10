// fuzzy-match.js
// Lightweight fuzzy string matching for search bars. Returns a score (0 = no
// match, higher = better). Handles typos by checking character-level overlap
// and substring containment.

/**
 * Returns true when `query` is a fuzzy match for `target`.
 * - Exact substring match always returns true.
 * - Otherwise uses a simple character-overlap ratio: if ≥ 60 % of the query
 *   characters appear in the target (order-insensitive), it counts as a match.
 *   This catches single-character typos, swaps, and minor omissions.
 */
export function fuzzyMatch(query, target) {
  if (!query || !target) return false;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring — always a hit.
  if (t.includes(q)) return true;

  // Short queries (1-2 chars) must be exact substrings — fuzzy matching at
  // that length produces too many false positives.
  if (q.length <= 2) return false;

  // Character-overlap ratio.
  const targetChars = t.split('');
  let matched = 0;
  const remaining = [...targetChars];
  for (const char of q) {
    const index = remaining.indexOf(char);
    if (index !== -1) {
      matched++;
      remaining.splice(index, 1);
    }
  }
  const ratio = matched / q.length;
  return ratio >= 0.6;
}

/**
 * Checks whether `query` fuzzy-matches ANY of the provided `fields`.
 */
export function fuzzyMatchAny(query, fields) {
  return fields.filter(Boolean).some((field) => fuzzyMatch(query, field));
}
