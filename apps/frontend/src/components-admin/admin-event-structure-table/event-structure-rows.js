// event-structure-rows.js
// The tree maths behind the rearrange table, kept apart from the React so the
// awkward parts — what counts as a group, where a row lands, what the two
// neighbour ids are — can be read without wading through drag handlers.
//
// WHAT A "GROUP" IS, AND WHY IT IS NOT SIMPLY "A TOP-LEVEL EVENT".
//
// A fest is either three layers (fest → Main Event → vertical) or two
// (fest → event), and the same screen has to render both. So:
//
//   · a top-level event WITH children is a Main Event, and its children are
//     its rows;
//   · top-level events WITHOUT children are rows themselves, collected into one
//     synthetic top-level group whose parentEventId is null.
//
// That synthetic group is what makes "drag across a divider to reparent" work
// in both shapes: dragging a vertical into it promotes the event to top level,
// which is the same move the tree expressed as dragging left to outdent.
//
// NEIGHBOURS, NOT INDICES — the same contract the tree used. The backend's
// move endpoint names the sibling immediately before and after the dropped row
// and mints the rank itself; nothing here computes a rank.

export const TOP_LEVEL_GROUP_ID = '__top-level__';

/*
 * The flat row list the table renders, in visual order, with each row carrying
 * the group it currently sits in. One pass, because the drag needs to answer
 * "which group is this index in" on every pointer move.
 */
export function buildGroups(roots, { topLevelLabel = 'Top level' } = {}) {
  const groups = [];
  const looseRows = [];

  (roots ?? []).forEach((node) => {
    const children = node.children ?? [];
    if (children.length > 0) {
      groups.push({
        groupId: node.id,
        groupName: node.eventName,
        parentEventId: node.id,
        mainEvent: node,
        rows: children,
      });
      return;
    }
    looseRows.push(node);
  });

  /*
   * The loose group goes LAST. It is where an event ends up when it is not
   * under a Main Event, and on a three-layer fest that is the exception — a
   * list that opens with its exceptions reads as though they are the subject.
   */
  if (looseRows.length > 0) {
    groups.push({
      groupId: TOP_LEVEL_GROUP_ID,
      groupName: topLevelLabel,
      parentEventId: null,
      mainEvent: null,
      rows: looseRows,
    });
  }

  return groups;
}

/* Every row in visual order, tagged with its group. The drag reads positions
   off this rather than off the nested tree. */
export function flattenRows(groups) {
  const rows = [];
  groups.forEach((group, groupIndex) => {
    group.rows.forEach((node, indexInGroup) => {
      rows.push({
        id: node.id,
        node,
        groupId: group.groupId,
        groupName: group.groupName,
        parentEventId: group.parentEventId,
        groupIndex,
        indexInGroup,
      });
    });
  });
  return rows;
}

/*
 * The two ids the move endpoint wants, read off the destination group as it
 * will look AFTER the row lands.
 *
 * `targetIndex` is the position the row takes in that list. The moved row is
 * removed from the destination first when it is already there, so dragging a
 * row down inside its own group does not name itself as its own neighbour —
 * which the server rejects.
 */
export function resolveNeighbours(destinationRows, movingEventId, targetIndex) {
  const without = destinationRows.filter((node) => node.id !== movingEventId);
  const clamped = Math.max(0, Math.min(targetIndex, without.length));
  return {
    previousSiblingId: clamped > 0 ? without[clamped - 1].id : null,
    nextSiblingId: clamped < without.length ? without[clamped].id : null,
  };
}

/*
 * The optimistic tree after the move.
 *
 * The screen renders from this immediately and rolls back to the previous roots
 * if the write fails, so it must be a faithful copy rather than a mutation —
 * the pre-drag tree is still being held as the rollback value.
 */
export function moveNodeInRoots(roots, movingEventId, destinationParentId, targetIndex) {
  let movingNode = null;

  /* Lift the node out wherever it is. */
  const removeFrom = (nodes) =>
    nodes.reduce((kept, node) => {
      if (node.id === movingEventId) {
        movingNode = node;
        return kept;
      }
      kept.push({ ...node, children: removeFrom(node.children ?? []) });
      return kept;
    }, []);

  const pruned = removeFrom(roots ?? []);
  if (!movingNode) {
    return roots;
  }

  if (destinationParentId === null) {
    const next = [...pruned];
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, movingNode);
    return next;
  }

  const insertInto = (nodes) =>
    nodes.map((node) => {
      if (node.id === destinationParentId) {
        const children = [...(node.children ?? [])];
        children.splice(Math.max(0, Math.min(targetIndex, children.length)), 0, movingNode);
        return { ...node, children };
      }
      return { ...node, children: insertInto(node.children ?? []) };
    });

  return insertInto(pruned);
}

/*
 * Would this move put an event inside its own subtree?
 *
 * The server refuses it with EVENT_CIRCULAR_PARENT, but refusing it here means
 * the row never visibly jumps to a place it cannot stay. Only reachable when a
 * Main Event is itself dragged, which the table allows through the synthetic
 * top-level group.
 */
export function isOwnDescendant(node, candidateParentId) {
  if (!candidateParentId) {
    return false;
  }
  const walk = (current) =>
    (current.children ?? []).some(
      (child) => child.id === candidateParentId || walk(child),
    );
  return node.id === candidateParentId || walk(node);
}
