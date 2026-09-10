const { EventModel } = require("../models/event-model");

/*
 * Event hierarchy scoping for the admin's cascading filter.
 *
 * "Selecting Chiduranga should show Chiduranga AND its sub-events" — so an
 * ?eventId= that names a parent has to expand to the whole subtree.
 *
 * Gathered with ONE query for the fest's flat (id, parentEventId) list, then an
 * iterative breadth-first walk in memory. Not $graphLookup: the tree is a fest's
 * events — tens of rows, three or four levels — so a single indexed find plus a
 * Map walk beats a server-side recursive aggregation and stays readable. The
 * walk carries a visited set, so a parentEventId cycle (which the model does not
 * prevent) terminates instead of hanging the request.
 */

/* Every descendant of eventId, at any depth, plus eventId itself. */
async function resolveEventScopeIds(festId, eventId, includeDescendants = false) {
  if (!eventId) {
    return null; // null means "no event narrowing" — the whole fest.
  }
  if (!includeDescendants) {
    return [String(eventId)];
  }

  const festEvents = await EventModel.find({ festId }).select("_id parentEventId").lean();

  const childIdsByParentId = new Map();
  for (const event of festEvents) {
    if (!event.parentEventId) {
      continue;
    }
    const parentKey = String(event.parentEventId);
    if (!childIdsByParentId.has(parentKey)) {
      childIdsByParentId.set(parentKey, []);
    }
    childIdsByParentId.get(parentKey).push(String(event._id));
  }

  const scopeIds = [];
  const visitedIds = new Set();
  const queue = [String(eventId)];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visitedIds.has(currentId)) {
      continue; // defends against a parentEventId cycle
    }
    visitedIds.add(currentId);
    scopeIds.push(currentId);
    queue.push(...(childIdsByParentId.get(currentId) ?? []));
  }
  return scopeIds;
}

/*
 * The scope object the analytics and export controllers build carries the
 * admin's chosen event plus the includeDescendants flag; this turns that into
 * the concrete id list, or null when nothing was chosen.
 */
async function resolveRequestedEventScopeIds(festId, scope) {
  if (!scope?.requestedEventIds?.length) {
    return null;
  }
  if (!scope.includeDescendants) {
    return scope.requestedEventIds.map(String);
  }
  const expandedIds = new Set();
  for (const requestedEventId of scope.requestedEventIds) {
    const subtreeIds = await resolveEventScopeIds(festId, requestedEventId, true);
    for (const scopeId of subtreeIds ?? []) {
      expandedIds.add(scopeId);
    }
  }
  return [...expandedIds];
}

/*
 * Every descendant of eventId, at any depth, NOT including eventId. The move
 * path needs this twice: to carry a subtree across fests, and to know which ids
 * a new parent may not be drawn from.
 *
 * Same one-query-then-walk-in-memory shape as resolveEventScopeIds above, and
 * the same visited set: a pre-existing parentEventId cycle in the data must not
 * hang the request that is trying to repair it.
 */
async function collectDescendantEventIds(festId, eventId) {
  const festEvents = await EventModel.find({ festId }).select("_id parentEventId").lean();

  const childIdsByParentId = new Map();
  for (const event of festEvents) {
    if (!event.parentEventId) {
      continue;
    }
    const parentKey = String(event.parentEventId);
    if (!childIdsByParentId.has(parentKey)) {
      childIdsByParentId.set(parentKey, []);
    }
    childIdsByParentId.get(parentKey).push(String(event._id));
  }

  const descendantIds = [];
  const visitedIds = new Set([String(eventId)]);
  const queue = [...(childIdsByParentId.get(String(eventId)) ?? [])];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visitedIds.has(currentId)) {
      continue;
    }
    visitedIds.add(currentId);
    descendantIds.push(currentId);
    queue.push(...(childIdsByParentId.get(currentId) ?? []));
  }
  return descendantIds;
}

/*
 * The circular-reference guard, walked from the PROPOSED PARENT UPWARDS rather
 * than from the moving event downwards.
 *
 * Both directions answer the same question, but upwards is the one that stays
 * correct across fests: the descendant walk is scoped to a single fest's rows,
 * so a cross-fest move could ask about a parent the walk never loaded and get
 * back a confident "no cycle". Following parentEventId hop by hop consults the
 * real edge every time.
 *
 * Returns the ancestor chain it walked (nearest first), which the audit entry
 * records so a refused or surprising move can be reconstructed later.
 */
async function assertParentIsNotDescendant(eventId, newParentEventId) {
  const movingId = String(eventId);
  const ancestorIds = [];
  const visitedIds = new Set();

  let cursorId = newParentEventId ? String(newParentEventId) : null;
  while (cursorId) {
    if (cursorId === movingId) {
      return { ok: false, ancestorIds };
    }
    if (visitedIds.has(cursorId)) {
      // A cycle that predates this move. Stop rather than loop forever; the
      // move is refused because we cannot prove it is safe.
      return { ok: false, ancestorIds };
    }
    visitedIds.add(cursorId);
    ancestorIds.push(cursorId);

    const parent = await EventModel.findById(cursorId).select("parentEventId").lean();
    if (!parent) {
      break;
    }
    cursorId = parent.parentEventId ? String(parent.parentEventId) : null;
  }
  return { ok: true, ancestorIds };
}

module.exports = {
  resolveEventScopeIds,
  resolveRequestedEventScopeIds,
  collectDescendantEventIds,
  assertParentIsNotDescendant,
};
