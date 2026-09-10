// sibling-rank-sort.js
// The one comparator for ordering events within a level.
//
// Events carry siblingRank, a lexicographic base-62 string the server mints;
// plain string comparison IS the order, and the event id is the stable
// tiebreaker so two rows that share a rank (an unranked pre-migration level,
// two concurrent creates) never swap between renders. This is the same rule
// the backend's structure service applies, and every client-side level sort
// must use it — the deprecated integer displayOrder is frozen and drifts from
// the true order with every drag.

export function compareBySiblingRank(left, right) {
  const leftRank = typeof left?.siblingRank === 'string' ? left.siblingRank : '';
  const rightRank = typeof right?.siblingRank === 'string' ? right.siblingRank : '';
  if (leftRank !== rightRank) {
    return leftRank < rightRank ? -1 : 1;
  }
  const leftId = String(left?.id ?? '');
  const rightId = String(right?.id ?? '');
  if (leftId === rightId) {
    return 0;
  }
  return leftId < rightId ? -1 : 1;
}

export default compareBySiblingRank;
