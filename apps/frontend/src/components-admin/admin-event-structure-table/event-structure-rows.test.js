/*
 * event-structure-rows.test.js
 *
 * The tree maths behind the rearrange table. These are the parts that are wrong
 * in a way you cannot see: a neighbour id that names the moved row itself, an
 * off-by-one when dragging downward inside a group, a "move" that silently
 * mutates the tree being held as the rollback value.
 *
 * The drag handlers are not tested here — they are React and a pointer
 * simulation would test dnd-kit rather than this code. Everything that decides
 * WHERE a row lands lives in this module precisely so it can be checked without
 * either.
 */
import { describe, it, expect } from 'vitest';
import {
  TOP_LEVEL_GROUP_ID,
  buildGroups,
  flattenRows,
  isOwnDescendant,
  moveNodeInRoots,
  resolveNeighbours,
} from './event-structure-rows.js';

/* fest → two Main Events with children, plus one childless top-level event. */
function buildRoots() {
  return [
    {
      id: 'tech',
      eventName: 'Technical',
      children: [
        { id: 'robo', eventName: 'Robowars', children: [] },
        { id: 'code', eventName: 'CodeSangram', children: [] },
      ],
    },
    {
      id: 'cult',
      eventName: 'Cultural',
      children: [{ id: 'bob', eventName: 'Battle of Bands', children: [] }],
    },
    { id: 'solo', eventName: 'Standalone Quiz', children: [] },
  ];
}

describe('buildGroups', () => {
  it('makes a group per Main Event and collects childless top-level events last', () => {
    const groups = buildGroups(buildRoots());

    expect(groups.map((group) => group.groupId)).toEqual(['tech', 'cult', TOP_LEVEL_GROUP_ID]);
    expect(groups[0].parentEventId).toBe('tech');
    /*
     * The synthetic group's parent is null, which is what makes "drag into it"
     * mean "promote to top level" — the same move the tree expressed as
     * dragging left to outdent.
     */
    expect(groups[2].parentEventId).toBeNull();
    expect(groups[2].rows.map((row) => row.id)).toEqual(['solo']);
  });

  it('omits the synthetic group entirely when every top-level event has children', () => {
    const groups = buildGroups([
      { id: 'tech', eventName: 'Technical', children: [{ id: 'robo', eventName: 'Robowars' }] },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe('tech');
  });

  it('handles a two-layer fest, where every event is a row and nothing is a group', () => {
    const groups = buildGroups([
      { id: 'a', eventName: 'A', children: [] },
      { id: 'b', eventName: 'B', children: [] },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe(TOP_LEVEL_GROUP_ID);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe('flattenRows', () => {
  it('tags every row with its group and its index inside it', () => {
    const rows = flattenRows(buildGroups(buildRoots()));

    expect(rows.map((row) => row.id)).toEqual(['robo', 'code', 'bob', 'solo']);
    expect(rows[1]).toMatchObject({ groupId: 'tech', indexInGroup: 1, groupIndex: 0 });
    expect(rows[2]).toMatchObject({ groupId: 'cult', indexInGroup: 0, groupIndex: 1 });
  });
});

describe('resolveNeighbours', () => {
  const destination = [
    { id: 'robo' },
    { id: 'code' },
    { id: 'quiz' },
  ];

  it('names the rows either side of the landing index', () => {
    expect(resolveNeighbours(destination, 'newcomer', 1)).toEqual({
      previousSiblingId: 'robo',
      nextSiblingId: 'code',
    });
  });

  it('returns null for the edges rather than wrapping', () => {
    expect(resolveNeighbours(destination, 'newcomer', 0).previousSiblingId).toBeNull();
    expect(resolveNeighbours(destination, 'newcomer', 3).nextSiblingId).toBeNull();
  });

  it('never names the moved row as its own neighbour', () => {
    /*
     * Dragging `code` to the end of its own group. Without removing it from the
     * destination first, index 2 would look back at `code` itself and the
     * server would reject the move.
     */
    const result = resolveNeighbours(destination, 'code', 2);

    expect(result.previousSiblingId).not.toBe('code');
    expect(result.nextSiblingId).not.toBe('code');
    expect(result).toEqual({ previousSiblingId: 'quiz', nextSiblingId: null });
  });

  it('clamps an index past the end instead of producing undefined ids', () => {
    expect(resolveNeighbours(destination, 'newcomer', 99)).toEqual({
      previousSiblingId: 'quiz',
      nextSiblingId: null,
    });
  });

  it('returns two nulls for an empty destination group', () => {
    expect(resolveNeighbours([], 'robo', 0)).toEqual({
      previousSiblingId: null,
      nextSiblingId: null,
    });
  });
});

describe('moveNodeInRoots', () => {
  it('reparents a row into another group', () => {
    const next = moveNodeInRoots(buildRoots(), 'robo', 'cult', 0);

    expect(next[0].children.map((child) => child.id)).toEqual(['code']);
    expect(next[1].children.map((child) => child.id)).toEqual(['robo', 'bob']);
  });

  it('promotes a row to top level when the destination parent is null', () => {
    const next = moveNodeInRoots(buildRoots(), 'robo', null, 3);

    expect(next.map((node) => node.id)).toEqual(['tech', 'cult', 'solo', 'robo']);
    expect(next[0].children.map((child) => child.id)).toEqual(['code']);
  });

  it('reorders within a group', () => {
    const next = moveNodeInRoots(buildRoots(), 'code', 'tech', 0);

    expect(next[0].children.map((child) => child.id)).toEqual(['code', 'robo']);
  });

  it('does not mutate the roots it was given', () => {
    /*
     * THE ROLLBACK DEPENDS ON THIS. The screen keeps the pre-drag tree to
     * restore if the write fails; a mutation here would corrupt the value it
     * is about to roll back to, and the failure would leave the table showing
     * the move it just told the reader had failed.
     */
    const roots = buildRoots();
    const snapshot = JSON.stringify(roots);

    moveNodeInRoots(roots, 'robo', 'cult', 0);

    expect(JSON.stringify(roots)).toBe(snapshot);
  });

  it('returns the original tree untouched when the id is not present', () => {
    const roots = buildRoots();

    expect(moveNodeInRoots(roots, 'missing', 'cult', 0)).toBe(roots);
  });

  it('carries a moved row’s own children with it', () => {
    const roots = [
      {
        id: 'tech',
        eventName: 'Technical',
        children: [
          { id: 'robo', eventName: 'Robowars', children: [{ id: 'heat1', children: [] }] },
        ],
      },
      { id: 'cult', eventName: 'Cultural', children: [{ id: 'bob', children: [] }] },
    ];

    const next = moveNodeInRoots(roots, 'robo', 'cult', 0);

    expect(next[1].children[0].children.map((child) => child.id)).toEqual(['heat1']);
  });
});

describe('isOwnDescendant', () => {
  const vertical = {
    id: 'tech',
    children: [{ id: 'robo', children: [{ id: 'heat1', children: [] }] }],
  };

  it('refuses a move into the row itself', () => {
    expect(isOwnDescendant(vertical, 'tech')).toBe(true);
  });

  it('refuses a move into a direct child and into a grandchild', () => {
    expect(isOwnDescendant(vertical, 'robo')).toBe(true);
    expect(isOwnDescendant(vertical, 'heat1')).toBe(true);
  });

  it('allows a move into an unrelated group, and to top level', () => {
    expect(isOwnDescendant(vertical, 'cult')).toBe(false);
    expect(isOwnDescendant(vertical, null)).toBe(false);
  });
});
