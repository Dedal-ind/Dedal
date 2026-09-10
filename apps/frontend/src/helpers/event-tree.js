// event-tree.js
// The one place the fest's event hierarchy is interpreted.
//
// THE SHAPE THE API GIVES US. GET /public/fests/:festId/events?includeChildren=true
// returns the WHOLE tree as one flat array — every node carries parentEventId
// and siblingRank, and nothing is nested. So the tree is available to the
// client; it just has to be rebuilt, and rebuilt the same way on both detail
// screens, which is why this is a module and not a function inside a screen.
//
// THE RULE THAT DECIDES EVERYTHING: an event with a `category` is a REGISTERABLE
// EVENT; an event without one is a CONTAINER (a vertical: Cultural, Technical,
// Sports). That is not invented here — it is the rule EventDetailScreen has
// always used to decide whether to show a register button, and reusing it is
// what stops the fest grid and the event page disagreeing about what a node is.
//
// It matters because the tree is three levels deep, not two:
//
//   fest → vertical (no category) → event (category) → rounds (children of an event)
//
// The screen this replaces treated "node with no children" as an event, so a
// heat of a swimming final was rendered as a card in the grid while the event
// it belonged to was filtered out of its own category. Reading `category`
// instead puts each node at the level it was created at.

const ROOT_KEY = 'root';

// Children keyed by parent id, each level ordered the way an administrator
// arranged it (siblingRank), falling back to start time and then to id so the
// order is total and never flickers between renders.
export function buildChildrenByParent(events) {
  const childrenByParent = new Map();
  (events ?? []).forEach((event) => {
    const key = event.parentEventId ?? ROOT_KEY;
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(event);
  });
  childrenByParent.forEach((children) => children.sort(compareSiblings));
  return childrenByParent;
}

/*
 * SIBLING RANK IS A STRING, AND IT IS COMPARED AS ONE.
 *
 * `siblingRank` is `{ type: String, default: null }` on the event model — a
 * LEXICOGRAPHIC rank, not an integer, so an admin can insert an event between
 * two others by minting a key that sorts between them without renumbering the
 * whole level. Real values coming off the tree endpoint look like "6", "F",
 * "O", "U", "a": single characters whose ORDER is the whole meaning.
 *
 * This function used to gate on `Number.isFinite(siblingRank)`, which is false
 * for every one of those, so every node fell through to MAX_SAFE_INTEGER, every
 * comparison tied, and the ordering silently degraded to start time — on the
 * fest grid, the category tabs, the rounds timeline and related events alike.
 * The admin's arrangement was being discarded everywhere, and nothing looked
 * broken because start time is a plausible-looking order.
 *
 * Nulls sort LAST rather than first: an unranked event is one nobody has placed
 * yet, and placing it at the top would let it displace events somebody did
 * deliberately arrange.
 */
function compareSiblings(first, second) {
  const rankFirst = typeof first.siblingRank === 'string' ? first.siblingRank : null;
  const rankSecond = typeof second.siblingRank === 'string' ? second.siblingRank : null;
  if (rankFirst !== rankSecond) {
    if (rankFirst === null) {
      return 1;
    }
    if (rankSecond === null) {
      return -1;
    }
    // Plain codepoint order, NOT localeCompare: these are generated sort keys,
    // and a locale-aware collation can order "A" and "a" differently from the
    // way the server minted them.
    return rankFirst < rankSecond ? -1 : 1;
  }
  const startFirst = first.startsAt ? new Date(first.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  const startSecond = second.startsAt ? new Date(second.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (startFirst !== startSecond) {
    return startFirst - startSecond;
  }
  return String(first.id).localeCompare(String(second.id));
}

export function rootNodes(childrenByParent) {
  return childrenByParent.get(ROOT_KEY) ?? [];
}

export function childrenOf(eventId, childrenByParent) {
  return childrenByParent.get(eventId) ?? [];
}

// Registerable: it has a category, so somebody can enter it.
export function isRegisterableEvent(event) {
  return Boolean(event?.category);
}

/*
 * A container groups other events and cannot be entered.
 *
 * Deliberately the exact negation of isRegisterableEvent rather than a second,
 * subtly different rule: a categorised node WITH children owns rounds, not
 * sub-events, so it is still the thing you register for. Both screens read this
 * pair, and the day they disagree is the day the grid shows a heat as an event.
 */
export function isContainerEvent(event) {
  return Boolean(event) && !isRegisterableEvent(event);
}

/*
 * Every registerable event at or below a node, in tree order. Descends through
 * nested verticals (a fest may put Sports → Athletics → 100m) but STOPS at the
 * first categorised node, so its rounds never surface as events of their own.
 */
export function registerableDescendants(eventId, childrenByParent) {
  const found = [];
  const walk = (parentId) => {
    childrenOf(parentId, childrenByParent).forEach((child) => {
      if (isRegisterableEvent(child)) {
        found.push(child);
      } else {
        walk(child.id);
      }
    });
  };
  walk(eventId);
  return found;
}

// Every registerable event in the fest, wherever it sits in the tree.
export function allRegisterableEvents(events) {
  return (events ?? []).filter(isRegisterableEvent);
}

// The rounds/heats of one event: its direct children. Named for what they are
// on the event page, which is the only place they are shown.
export function roundsOf(eventId, childrenByParent) {
  return childrenOf(eventId, childrenByParent);
}
