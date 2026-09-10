/*
 * Lexicographic sibling ranks for the event structure editor.
 *
 * A rank is a string over a fixed base-62 alphabet whose ASCII order IS the
 * sort order, so a level of siblings is ordered by plain string comparison of
 * this field (with _id as the stable tiebreaker). The point of a string rather
 * than an integer is that a new rank can ALWAYS be minted strictly between two
 * existing ones without touching either neighbour: dropping an event into a
 * gap writes one row, never a renumbered level.
 *
 * The strings behave like fractions in [0, 1) written in base 62 — "V" is
 * 31/62, "VV" is 31/62 + 31/62². Two invariants keep "strictly between" always
 * satisfiable:
 *   - a generated rank never ends in the alphabet's first character ('0'), so
 *     "U" and "U0" (which would have nothing between them) cannot both exist;
 *   - when two neighbours share a prefix and their next digits are adjacent,
 *     the result copies the lower neighbour's digit and extends by a further
 *     character rather than giving up.
 *
 * Deliberately free of any model or database dependency: it is arithmetic on
 * strings, and it is tested as such.
 */

const RANK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANK_BASE = RANK_ALPHABET.length;
const MINIMUM_CHARACTER = RANK_ALPHABET[0];

/*
 * Repeated drops into the same gap lengthen the rank by roughly one character
 * per six drops. A level that has been dragged around enough to pass this
 * ceiling is rewritten to short evenly spaced ranks by the rebalance routine,
 * which the move path runs opportunistically for that level only.
 */
const RANK_LENGTH_CEILING = 24;

const DIGIT_BY_CHARACTER = new Map(
  Array.from(RANK_ALPHABET, (character, index) => [character, index])
);

/*
 * A stored rank is trusted only if it is a non-empty string made purely of
 * alphabet characters. Anything else — null, "", a number, a stray unicode
 * character from a hand edit — is reported as absent so a reader falls back to
 * the "no rank yet" branch instead of comparing garbage. Trailing minimum
 * characters are stripped because "U0" and "U" denote the same fraction and
 * the second is the canonical spelling.
 */
function normaliseRank(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  for (const character of value) {
    if (!DIGIT_BY_CHARACTER.has(character)) {
      return null;
    }
  }
  let end = value.length;
  while (end > 0 && value[end - 1] === MINIMUM_CHARACTER) {
    end -= 1;
  }
  return end === 0 ? null : value.slice(0, end);
}

function digitAt(rank, index) {
  return index < rank.length ? DIGIT_BY_CHARACTER.get(rank[index]) : 0;
}

/*
 * A rank strictly between lower and upper. Either bound may be null: a null
 * lower bound is "nothing before", a null upper bound is "nothing after", and
 * both null is the first rank of an empty level.
 *
 * Throws only when lower >= upper, which no correct sequence of operations can
 * produce; a caller holding stored ranks that violate it is looking at a
 * corrupted level and should rebalance it, not guess.
 */
function rankBetween(lowerValue, upperValue) {
  const lower = normaliseRank(lowerValue) ?? "";
  let upper = normaliseRank(upperValue);

  if (upper !== null && lower >= upper) {
    throw new Error(`Cannot rank between "${lower}" and "${upper}": bounds are not ascending.`);
  }

  let result = "";
  for (let index = 0; ; index += 1) {
    const lowerDigit = digitAt(lower, index);
    const upperDigit = upper === null ? RANK_BASE : digitAt(upper, index);

    if (upperDigit - lowerDigit > 1) {
      // Room for a digit in this position: take the midpoint and stop.
      return result + RANK_ALPHABET[Math.floor((lowerDigit + upperDigit) / 2)];
    }

    /*
     * Adjacent or equal digits. Copy the lower one and carry on: the prefix so
     * far is still < upper (either the digit is smaller, or equal with more
     * digits to come), so the upper bound only stays in play while the digits
     * remain equal.
     */
    result += RANK_ALPHABET[lowerDigit];
    if (upperDigit - lowerDigit === 1) {
      upper = null;
    }
    // Equal digits with both bounds exhausted cannot happen: normalised bounds
    // with lower < upper differ somewhere, and the loop reaches that position.
  }
}

/* A rank that sorts before the current first sibling (or the first rank of an empty level). */
function rankBefore(firstValue) {
  return rankBetween(null, firstValue);
}

/* A rank that sorts after the current last sibling (or the first rank of an empty level). */
function rankAfter(lastValue) {
  return rankBetween(lastValue, null);
}

/*
 * `count` short ranks, evenly spread through the space and already in order.
 * Used by the rebalance routine to rewrite one level whose ranks have grown
 * past RANK_LENGTH_CEILING. The width is the fewest characters that leave a
 * gap of at least one full digit between neighbours, so the level has room to
 * absorb further drags before it needs rebalancing again.
 */
function evenlySpacedRanks(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("evenlySpacedRanks needs a non-negative integer count.");
  }
  if (count === 0) {
    return [];
  }

  let width = 1;
  let capacity = RANK_BASE;
  while (capacity / (count + 1) < 2) {
    width += 1;
    capacity *= RANK_BASE;
  }

  const step = Math.floor(capacity / (count + 1));
  const ranks = [];
  for (let position = 1; position <= count; position += 1) {
    let remaining = position * step;
    let rank = "";
    for (let place = 0; place < width; place += 1) {
      rank = RANK_ALPHABET[remaining % RANK_BASE] + rank;
      remaining = Math.floor(remaining / RANK_BASE);
    }
    ranks.push(normaliseRank(rank));
  }
  return ranks;
}

/* String comparison that puts absent (null) ranks first, for in-memory sorts. */
function compareRanks(leftValue, rightValue) {
  const left = normaliseRank(leftValue);
  const right = normaliseRank(rightValue);
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return left < right ? -1 : 1;
}

module.exports = {
  RANK_ALPHABET,
  RANK_LENGTH_CEILING,
  normaliseRank,
  rankBetween,
  rankBefore,
  rankAfter,
  evenlySpacedRanks,
  compareRanks,
};
