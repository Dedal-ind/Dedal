import { describe, it, expect } from 'vitest';
import { compareBySiblingRank } from './sibling-rank-sort.js';

/*
 * The level order the results board's event dropdown and the structure screen
 * both draw: sibling rank as a plain string, event id as the tiebreaker. The
 * frozen integer displayOrder must play no part.
 */
describe('compareBySiblingRank', () => {
  it('orders a level by siblingRank as a plain string, not by displayOrder', () => {
    const level = [
      { id: 'c', eventName: 'Third', siblingRank: 'k', displayOrder: 0 },
      { id: 'a', eventName: 'First', siblingRank: 'F', displayOrder: 2 },
      { id: 'b', eventName: 'Second', siblingRank: 'V', displayOrder: 1 },
    ];
    expect([...level].sort(compareBySiblingRank).map((event) => event.id)).toEqual(['a', 'b', 'c']);
  });

  it('compares ranks lexicographically, so a longer rank sits between its neighbours', () => {
    const level = [
      { id: 'x', siblingRank: 'V' },
      { id: 'y', siblingRank: 'UV' },
      { id: 'z', siblingRank: 'U' },
    ];
    expect([...level].sort(compareBySiblingRank).map((event) => event.id)).toEqual(['z', 'y', 'x']);
  });

  it('breaks a tie on rank by id, and never by name or displayOrder', () => {
    const level = [
      { id: '2', eventName: 'Alpha', siblingRank: 'V', displayOrder: 0 },
      { id: '1', eventName: 'Zulu', siblingRank: 'V', displayOrder: 5 },
    ];
    expect([...level].sort(compareBySiblingRank).map((event) => event.id)).toEqual(['1', '2']);
  });

  it('sorts an unranked (pre-migration) event first, then by id among unranked rows', () => {
    const level = [
      { id: 'b', siblingRank: 'A' },
      { id: 'd', siblingRank: null },
      { id: 'c' },
      { id: 'a', siblingRank: 'B' },
    ];
    expect([...level].sort(compareBySiblingRank).map((event) => event.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('is a consistent comparator: equal rows compare as zero', () => {
    const row = { id: 'same', siblingRank: 'V' };
    expect(compareBySiblingRank(row, { ...row })).toBe(0);
  });
});
