const mongoose = require("mongoose");

const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const {
  collectDescendantEventIds,
  assertParentIsNotDescendant,
} = require("../helpers/event-descendant-helpers");
const {
  RANK_LENGTH_CEILING,
  normaliseRank,
  rankBetween,
  evenlySpacedRanks,
} = require("../helpers/sibling-rank-helpers");

/*
 * The structure editor's writes: moving an event around the hierarchy, and the
 * batched form of the same for one drag session that shuffled several rows.
 *
 * Kept out of event-service.js deliberately. That file is already the fest's
 * event CRUD, cancellation cascade and public serialisation; the ordering rules
 * here share none of that beyond the model, and the one thing they must not do
 * is get mixed into the update path, where a stray rank write would silently
 * reshuffle a level nobody dragged.
 *
 * siblingRank is a position among SIBLINGS — events sharing a festId and
 * parentEventId — as a lexicographic string (see sibling-rank-helpers). A drop
 * names the two neighbours it landed between; the server reads THEIR current
 * stored ranks, mints a rank strictly between, and writes that one row. No
 * level is ever renumbered on the drag path. The only time other rows of a
 * level are written is the rebalance, which runs when a minted rank has grown
 * past a length ceiling and rewrites that one level to short even ranks.
 */

const MOVE_TARGET_SELECT = "_id festId parentEventId siblingRank eventName";

async function findEventInFestOrThrow(festId, eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId) ? await EventModel.findById(eventId) : null;
  if (!event || String(event.festId) !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

function siblingConflict(message, details) {
  return new ApplicationError(409, ERROR_CODES.EVENT_SIBLING_CONFLICT, message, details);
}

function sameId(left, right) {
  return String(left ?? "") === String(right ?? "");
}

/*
 * One level of one fest in its current order: rank ascending, _id as the
 * stable tiebreaker. _id is not decoration — two rows may legitimately share a
 * rank (a level created before the backfill, or two concurrent creates), and
 * without a second key Mongo may hand those back in a different sequence each
 * call.
 */
async function loadLevelInOrder(festId, parentEventId) {
  return EventModel.find({ festId, parentEventId: parentEventId ?? null })
    .select(MOVE_TARGET_SELECT)
    .sort({ siblingRank: 1, _id: 1 })
    .lean();
}

/*
 * MAINTENANCE, NOT THE DRAG PATH. Rewrites one level to short evenly spaced
 * ranks that preserve its current order. Called opportunistically by a move
 * for the level it just wrote into, and only when the minted rank passed the
 * ceiling — never for a whole fest, never as part of every drag. Also the
 * repair for a level whose stored ranks are inconsistent (missing, or not
 * ascending), because a rank cannot be minted between two bounds that do not
 * order.
 *
 * Only rows whose rank actually changes are written.
 */
async function rebalanceLevel(festId, parentEventId) {
  const level = await loadLevelInOrder(festId, parentEventId);
  const ranks = evenlySpacedRanks(level.length);

  const operations = [];
  level.forEach((row, index) => {
    if (normaliseRank(row.siblingRank) !== ranks[index]) {
      operations.push({
        updateOne: { filter: { _id: row._id }, update: { $set: { siblingRank: ranks[index] } } },
      });
    }
  });

  if (operations.length > 0) {
    await EventModel.bulkWrite(operations, { ordered: true });
  }
  return { levelSize: level.length, rewrittenCount: operations.length };
}

/*
 * The neighbours a drop named, resolved against the DATABASE rather than the
 * client. The client tells us which two rows it dropped between; their ranks
 * come from the rows as stored right now. A stale client that still shows a
 * neighbour on this level when it has since moved would otherwise write a rank
 * into a gap that no longer exists, so a neighbour that is missing, on another
 * fest, under another parent, or is the moved event itself, is a conflict the
 * client retries from a fresh tree.
 */
async function resolveNeighbour(neighbourId, fieldName, { festId, parentEventId, movingEventId }) {
  if (!neighbourId) {
    return null;
  }
  const neighbour = mongoose.Types.ObjectId.isValid(neighbourId)
    ? await EventModel.findById(neighbourId).select(MOVE_TARGET_SELECT).lean()
    : null;
  if (!neighbour) {
    throw siblingConflict("A neighbouring event no longer exists; reload and retry.", {
      [fieldName]: String(neighbourId),
    });
  }
  if (sameId(neighbour._id, movingEventId)) {
    throw siblingConflict("An event cannot be its own neighbour.", {
      [fieldName]: String(neighbourId),
    });
  }
  if (!sameId(neighbour.festId, festId) || !sameId(neighbour.parentEventId, parentEventId)) {
    throw siblingConflict("A neighbouring event has moved to another level; reload and retry.", {
      [fieldName]: String(neighbourId),
    });
  }
  return neighbour;
}

/*
 * The rank to write for a drop between two resolved neighbours (either may be
 * null for "start" / "end" of the level). If the stored bounds cannot be
 * ordered — one is unranked, or they are not ascending — the level is repaired
 * in place and the neighbours re-read once before minting. The repair is the
 * one situation in which a drag touches rows other than the moved one, and it
 * only ever happens to a level that was already broken.
 */
async function mintRankBetween(previous, next, level) {
  const previousRank = previous ? normaliseRank(previous.siblingRank) : null;
  const nextRank = next ? normaliseRank(next.siblingRank) : null;

  const boundsOrdered =
    (previous === null || previousRank !== null) &&
    (next === null || nextRank !== null) &&
    (previousRank === null || nextRank === null || previousRank < nextRank);

  if (boundsOrdered) {
    return rankBetween(previousRank, nextRank);
  }

  await rebalanceLevel(level.festId, level.parentEventId);
  const reread = async (row) =>
    row ? EventModel.findById(row._id).select("siblingRank").lean() : null;
  const [freshPrevious, freshNext] = await Promise.all([reread(previous), reread(next)]);
  return rankBetween(freshPrevious?.siblingRank ?? null, freshNext?.siblingRank ?? null);
}

/* The proposed parent must exist and sit in the fest the event is moving INTO. */
async function resolveMoveParent(targetFestId, newParentEventId) {
  if (!newParentEventId) {
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(newParentEventId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.");
  }
  const parent = await EventModel.findById(newParentEventId).select(MOVE_TARGET_SELECT);
  if (!parent) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.");
  }
  if (String(parent.festId) !== String(targetFestId)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.PARENT_EVENT_WRONG_FEST,
      "The parent event belongs to a different fest."
    );
  }
  return parent;
}

/*
 * Moves one event: reparent, reorder, and optionally carry it and its whole
 * subtree into another fest.
 *
 * Exactly one row is written for the ordering: the moved event's own, with the
 * rank minted between the two neighbours the drop named. The level it left is
 * not touched — with string ranks there is no gap to close.
 *
 * A cross-fest move rewrites festId on every descendant, because festId is
 * denormalised onto each row rather than inferred by walking to the root — the
 * fest's event list is a flat find({ festId }), so a child left behind would
 * stop appearing anywhere while still pointing at a parent that moved.
 */
async function moveEvent(userId, festId, eventId, payload, context = {}) {
  await assertAdministratorOfFest(userId, festId);
  const event = await findEventInFestOrThrow(festId, eventId);

  const sourceParentId = event.parentEventId ? String(event.parentEventId) : null;
  const sourceFestId = String(event.festId);

  /*
   * A cross-fest move needs admin rights on the DESTINATION too, not only the
   * source. Without this the endpoint would hand an event to a fest the caller
   * does not administer, using rights they hold over the fest it came from.
   */
  let targetFestId = sourceFestId;
  if (payload.newFestId && String(payload.newFestId) !== sourceFestId) {
    const { fest: destinationFest } = await assertAdministratorOfFest(userId, payload.newFestId);
    targetFestId = String(destinationFest.id);
  }

  const parent = await resolveMoveParent(targetFestId, payload.newParentEventId);

  const { ok } = await assertParentIsNotDescendant(event._id, parent ? parent._id : null);
  if (!ok) {
    throw new ApplicationError(
      400,
      ERROR_CODES.EVENT_CIRCULAR_PARENT,
      "Cannot move an event under its own descendant."
    );
  }

  const targetParentId = parent ? String(parent._id) : null;
  const level = { festId: targetFestId, parentEventId: targetParentId, movingEventId: event._id };

  const previous = await resolveNeighbour(payload.previousSiblingId, "previousSiblingId", level);
  const next = await resolveNeighbour(payload.nextSiblingId, "nextSiblingId", level);
  const siblingRank = await mintRankBetween(previous, next, level);

  const descendantIds =
    targetFestId === sourceFestId ? [] : await collectDescendantEventIds(sourceFestId, event._id);

  const beforeState = {
    festId: sourceFestId,
    parentEventId: sourceParentId,
    siblingRank: event.siblingRank ?? null,
  };

  event.festId = new mongoose.Types.ObjectId(targetFestId);
  event.parentEventId = targetParentId ? new mongoose.Types.ObjectId(targetParentId) : null;
  event.siblingRank = siblingRank;
  await event.save();

  if (descendantIds.length > 0) {
    await EventModel.updateMany(
      { _id: { $in: descendantIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { festId: new mongoose.Types.ObjectId(targetFestId) } }
    );
  }

  // Opportunistic, and for the destination level only.
  if (siblingRank.length > RANK_LENGTH_CEILING) {
    await rebalanceLevel(targetFestId, targetParentId);
  }

  const moved = await EventModel.findById(event._id);
  await recordAuditLog({
    actorUserId: userId,
    festId: moved.festId,
    action: AUDIT_ACTIONS.EVENT_MOVED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: moved._id,
    beforeState,
    afterState: {
      festId: String(moved.festId),
      parentEventId: moved.parentEventId ? String(moved.parentEventId) : null,
      siblingRank: moved.siblingRank,
      movedDescendantCount: descendantIds.length,
    },
    ...context,
  });

  return moved.toJSON();
}

/*
 * The batched form: one drag session that shuffled several rows at once.
 *
 * Every item is validated BEFORE anything is written — each must belong to this
 * fest, the batch as a whole must not describe a cycle, and every named
 * neighbour must resolve on the level the item is landing in. A partial apply
 * is the outcome worth engineering against, because the half that lands is a
 * hierarchy the admin never asked for and cannot see is wrong. Mongo standalone
 * has no multi-document transaction, so the guarantee is "validate everything,
 * then one ordered bulkWrite", not true atomicity.
 *
 * Ranks are minted in item order against a working view of the batch: an item
 * whose neighbour is an earlier item in the same batch sees that item's NEW
 * rank and parent, so a batch that moves several siblings of one level in
 * sequence produces a consistently ordered level.
 *
 * RETAINED WITHOUT A CALLER. Since the sibling-rank migration a drop in the
 * structure editor repositions exactly one row and calls moveEvent; no client
 * code calls this. It is kept deliberately for a future multi-row drag. Do not
 * delete it as dead code, and do not assume production exercises it — the
 * unit tests in event-structure-service.test.js are its only coverage.
 */
async function reorderEvents(userId, festId, orderings, context = {}) {
  const { fest } = await assertAdministratorOfFest(userId, festId);

  const eventIds = orderings.map((ordering) => String(ordering.eventId));
  const events = await EventModel.find({ festId: fest.id, _id: { $in: eventIds } })
    .select(MOVE_TARGET_SELECT)
    .lean();
  const eventsById = new Map(events.map((row) => [String(row._id), row]));

  for (const ordering of orderings) {
    if (!eventsById.has(String(ordering.eventId))) {
      throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found in this fest.", {
        eventId: String(ordering.eventId),
      });
    }
  }

  /*
   * The cycle check runs against the PROPOSED tree, not the stored one. Walking
   * stored parentEventId would clear a batch that only becomes circular once
   * applied — "A under B" and "B under A" in the same payload are each legal
   * row by row, and a detached ring afterwards.
   */
  const proposedParentById = new Map(
    orderings.map((ordering) => [
      String(ordering.eventId),
      ordering.parentEventId ? String(ordering.parentEventId) : null,
    ])
  );

  for (const ordering of orderings) {
    const movingId = String(ordering.eventId);
    const visited = new Set([movingId]);
    let cursorId = proposedParentById.get(movingId) ?? null;

    while (cursorId) {
      if (cursorId === movingId || visited.has(cursorId)) {
        throw new ApplicationError(
          400,
          ERROR_CODES.EVENT_CIRCULAR_PARENT,
          "Cannot move an event under its own descendant.",
          { eventId: movingId }
        );
      }
      visited.add(cursorId);

      // A parent named in this same batch is followed through its PROPOSED
      // parent; one outside the batch falls back to the stored edge.
      if (proposedParentById.has(cursorId)) {
        cursorId = proposedParentById.get(cursorId);
        continue;
      }

      const stored =
        eventsById.get(cursorId) ??
        (await EventModel.findById(cursorId).select("parentEventId festId").lean());
      if (!stored) {
        throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.", {
          eventId: cursorId,
        });
      }
      if (String(stored.festId) !== String(fest.id)) {
        throw new ApplicationError(
          400,
          ERROR_CODES.PARENT_EVENT_WRONG_FEST,
          "The parent event belongs to a different fest."
        );
      }
      cursorId = stored.parentEventId ? String(stored.parentEventId) : null;
    }
  }

  /*
   * Working view: where each event sits and what rank it holds, updated as the
   * batch is walked so later items see earlier items' proposed positions.
   * Items in the batch start from their stored row; a neighbour outside the
   * batch is read once and cached.
   */
  const workingById = new Map(
    events.map((row) => [
      String(row._id),
      {
        parentEventId: row.parentEventId ? String(row.parentEventId) : null,
        siblingRank: normaliseRank(row.siblingRank),
      },
    ])
  );

  async function resolveBatchNeighbour(neighbourId, fieldName, ordering) {
    if (!neighbourId) {
      return null;
    }
    const key = String(neighbourId);
    if (key === String(ordering.eventId)) {
      throw siblingConflict("An event cannot be its own neighbour.", {
        eventId: String(ordering.eventId),
        [fieldName]: key,
      });
    }
    if (!workingById.has(key)) {
      const stored = mongoose.Types.ObjectId.isValid(key)
        ? await EventModel.findById(key).select(MOVE_TARGET_SELECT).lean()
        : null;
      if (!stored || String(stored.festId) !== String(fest.id)) {
        throw siblingConflict("A neighbouring event no longer exists; reload and retry.", {
          eventId: String(ordering.eventId),
          [fieldName]: key,
        });
      }
      workingById.set(key, {
        parentEventId: stored.parentEventId ? String(stored.parentEventId) : null,
        siblingRank: normaliseRank(stored.siblingRank),
      });
    }
    const neighbour = workingById.get(key);
    if (neighbour.parentEventId !== (ordering.parentEventId ?? null)) {
      throw siblingConflict("A neighbouring event has moved to another level; reload and retry.", {
        eventId: String(ordering.eventId),
        [fieldName]: key,
      });
    }
    return neighbour;
  }

  const rankById = new Map();
  const levelsPastCeiling = new Map();

  for (const ordering of orderings) {
    const previous = await resolveBatchNeighbour(
      ordering.previousSiblingId,
      "previousSiblingId",
      ordering
    );
    const next = await resolveBatchNeighbour(ordering.nextSiblingId, "nextSiblingId", ordering);

    const previousRank = previous ? previous.siblingRank : null;
    const nextRank = next ? next.siblingRank : null;
    const boundsOrdered =
      (previous === null || previousRank !== null) &&
      (next === null || nextRank !== null) &&
      (previousRank === null || nextRank === null || previousRank < nextRank);
    if (!boundsOrdered) {
      /*
       * Nothing has been written yet, so unlike the single move this cannot
       * repair the level in place and carry on — a repair would be a write
       * before validation finished. The client reloads and resubmits.
       */
      throw siblingConflict("The neighbours named for this event are no longer in order.", {
        eventId: String(ordering.eventId),
      });
    }

    const siblingRank = rankBetween(previousRank, nextRank);
    const eventKey = String(ordering.eventId);
    rankById.set(eventKey, siblingRank);
    workingById.set(eventKey, { parentEventId: ordering.parentEventId ?? null, siblingRank });

    if (siblingRank.length > RANK_LENGTH_CEILING) {
      levelsPastCeiling.set(String(ordering.parentEventId ?? ""), ordering.parentEventId ?? null);
    }
  }

  const operations = orderings.map((ordering) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(String(ordering.eventId)), festId: fest.id },
      update: {
        $set: {
          parentEventId: ordering.parentEventId
            ? new mongoose.Types.ObjectId(String(ordering.parentEventId))
            : null,
          siblingRank: rankById.get(String(ordering.eventId)),
        },
      },
    },
  }));

  if (operations.length > 0) {
    await EventModel.bulkWrite(operations, { ordered: true });
  }

  for (const parentEventId of levelsPastCeiling.values()) {
    await rebalanceLevel(fest.id, parentEventId);
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: fest.id,
    action: AUDIT_ACTIONS.EVENT_REORDERED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: fest.id,
    afterState: { reorderedCount: operations.length, eventIds },
    ...context,
  });

  return { reorderedCount: operations.length };
}

module.exports = { moveEvent, reorderEvents, rebalanceLevel };
