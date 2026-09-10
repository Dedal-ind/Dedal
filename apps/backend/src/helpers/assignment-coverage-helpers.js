const { CHECKPOINT_TYPES } = require("../constants/scan-constants");
const { EventModel } = require("../models/event-model");

// A run-away parent chain (corrupted data) must not loop forever.
const ANCESTOR_WALK_MAX_DEPTH = 10;

/*
 * Whether the target event descends — at any depth — from an event the assignment
 * names. Walks the parentEventId chain upward: a coordinator assigned to a vertical
 * (Shastra) covers its children (CodeSangram) and grandchildren (AstraCode). Loads
 * only parentEventId at each hop, and stops at the root or the depth cap.
 */
async function eventDescendsFromAssignedEvent(assignment, eventId) {
  const assignedIds = new Set((assignment.eventIds || []).map((id) => String(id)));
  if (assignedIds.size === 0) {
    return false;
  }
  let currentId = eventId;
  for (let depth = 0; depth < ANCESTOR_WALK_MAX_DEPTH; depth += 1) {
    const current = await EventModel.findById(currentId).select("parentEventId").lean();
    if (!current || !current.parentEventId) {
      return false;
    }
    if (assignedIds.has(String(current.parentEventId))) {
      return true;
    }
    currentId = current.parentEventId;
  }
  return false;
}

/*
 * Whether an assignment covers a specific event: it names the event, names no event
 * at all (empty eventIds = the whole fest), or names an ancestor of it (a vertical
 * covers its sub-events). The single source of truth for the fest-wide rule, used
 * by the event authorization gate and the event staff roster. Async since the
 * ancestor walk reads the event tree.
 */
async function assignmentCoversEvent(assignment, eventId) {
  if (!assignment.eventIds || assignment.eventIds.length === 0) {
    return true;
  }
  if (assignment.eventIds.some((id) => String(id) === String(eventId))) {
    return true;
  }
  return eventDescendsFromAssignedEvent(assignment, eventId);
}

/*
 * Whether a staffAssignment covers a checkpoint. A gate is covered by any active
 * assignment for its fest; an event door is covered when the assignment covers the
 * checkpoint's event (hierarchy-aware via assignmentCoversEvent). Async because
 * that event check now walks the tree. Shared by scanner authorization and the
 * coordinator scoping on the shift endpoints.
 */
async function assignmentCoversCheckpoint(assignment, checkpoint) {
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.GATE) {
    return true;
  }
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.OFFER) {
    /*
     * Offer counters are covered by any active assignment for the fest. There is
     * no per-offer narrowing on the ASSIGNMENT (reverted — see the note on
     * staff-assignment-model): a volunteer's actual reach is decided by the
     * SHIFT they are scheduled on, which names one checkpoint, so a volunteer on
     * "Food — Dining Hall" still cannot scan at any other counter.
     */
    return true;
  }
  return assignmentCoversEvent(assignment, checkpoint.eventId);
}

/*
 * The same fest-wide rule as a query scope rather than a predicate: null means
 * "every event of the fest", an array means "only these".
 *
 * Stated here because this file already owns what an empty eventIds means, and a
 * caller reaching for `assignment.eventIds` directly is how that meaning gets
 * lost — an empty array is truthy, so `{ $in: eventIds }` silently becomes
 * "match nothing", the exact inversion of what the assignment grants.
 */
function resolveAssignmentEventScope(assignment) {
  if (!assignment || !assignment.eventIds || assignment.eventIds.length === 0) {
    return null;
  }
  return assignment.eventIds;
}

// A null bound is open-ended: an assignment naming no event has no window to fail.
function isWithinAssignmentWindow(assignment, now) {
  if (assignment.validFrom && now < assignment.validFrom) {
    return false;
  }
  if (assignment.validTo && now > assignment.validTo) {
    return false;
  }
  return true;
}

module.exports = {
  assignmentCoversCheckpoint,
  assignmentCoversEvent,
  eventDescendsFromAssignedEvent,
  resolveAssignmentEventScope,
  isWithinAssignmentWindow,
};
