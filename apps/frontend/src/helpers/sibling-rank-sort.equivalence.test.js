import { describe, it, expect } from 'vitest';
import { compareBySiblingRank } from './sibling-rank-sort.js';

/*
 * The comparator the fest structure screen carried inline before it was
 * folded onto the shared helper, reproduced verbatim. This test exists to
 * prove the fold changed nothing: over every shape of level the screen can
 * meet, both comparators must sort identically.
 */
function formerStructureScreenComparator(left, right) {
  const leftRank = typeof left.siblingRank === 'string' ? left.siblingRank : '';
  const rightRank = typeof right.siblingRank === 'string' ? right.siblingRank : '';
  if (leftRank !== rightRank) {
    return leftRank < rightRank ? -1 : 1;
  }
  const leftId = String(left.id);
  const rightId = String(right.id);
  if (leftId === rightId) {
    return 0;
  }
  return leftId < rightId ? -1 : 1;
}

/* Deterministic pseudo-random so a failure reproduces. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomLevel(random, size) {
  const level = [];
  for (let index = 0; index < size; index += 1) {
    const roll = random();
    let siblingRank;
    if (roll < 0.15) {
      siblingRank = null; // unranked, pre-migration
    } else if (roll < 0.2) {
      siblingRank = undefined; // field absent
    } else if (roll < 0.25) {
      siblingRank = 3; // malformed
    } else {
      const length = 1 + Math.floor(random() * 4);
      siblingRank = Array.from({ length }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join('');
    }
    level.push({
      // Ids collide on purpose sometimes, and share ranks on purpose sometimes.
      id: `id${Math.floor(random() * (size * 2))}`,
      siblingRank,
      displayOrder: Math.floor(random() * 5),
    });
  }
  return level;
}

describe('structure screen fold onto compareBySiblingRank', () => {
  it('sorts every level exactly as the former inline comparator did', () => {
    const random = makeRandom(20260907);
    for (let round = 0; round < 500; round += 1) {
      const level = randomLevel(random, 1 + Math.floor(random() * 12));
      const before = [...level].sort(formerStructureScreenComparator);
      const after = [...level].sort(compareBySiblingRank);
      expect(after).toEqual(before);
      // And pairwise, every comparison agrees in sign.
      for (const left of level) {
        for (const right of level) {
          expect(Math.sign(compareBySiblingRank(left, right))).toBe(
            Math.sign(formerStructureScreenComparator(left, right)),
          );
        }
      }
    }
  });
});
