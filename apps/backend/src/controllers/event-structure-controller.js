const mongoose = require("mongoose");

const eventStructureService = require("../services/event-structure-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * Request shaping for the structure editor. Everything here is a shape check
 * only — that an id looks like an id. Whether the move is *legal* (the fest
 * owns the event, the parent is not a descendant, the named neighbours are
 * still where the client thinks they are) is the service's call, because those
 * questions need the database.
 *
 * A drop is described by its two NEIGHBOURS — previousSiblingId is the event
 * that will sit immediately before the dropped one, nextSiblingId the one
 * immediately after. Either may be absent (or null) for a drop at the start or
 * the end of the level. The client never sends a rank or an index: the server
 * reads the neighbours' stored ranks and mints one between them.
 */

const VALIDATION_FAILED = "VALIDATION_FAILED";

function invalid(response, details) {
  return response.status(400).json({
    error: { code: VALIDATION_FAILED, message: "One or more fields are invalid.", details },
  });
}

/*
 * null and absent mean different things on this endpoint and must not collapse:
 * an explicit null parentEventId is "move to top level", while an absent one on
 * the bulk path would be a caller that forgot the field. The move endpoint
 * treats absent as null (a body with no parent named is a top-level drop); the
 * bulk path requires the key to be present.
 */
function readOptionalObjectId(value, fieldName, details) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(value)) {
    details[fieldName] = "must be a valid id or null";
    return null;
  }
  return String(value);
}

async function patchMoveEvent(request, response) {
  const details = {};
  const { newParentEventId, newFestId, previousSiblingId, nextSiblingId } = request.body ?? {};

  const parentEventId = readOptionalObjectId(newParentEventId, "newParentEventId", details);
  const festId = readOptionalObjectId(newFestId, "newFestId", details);
  const previousId = readOptionalObjectId(previousSiblingId, "previousSiblingId", details);
  const nextId = readOptionalObjectId(nextSiblingId, "nextSiblingId", details);

  if (Object.keys(details).length > 0) {
    return invalid(response, details);
  }

  const { userId } = request.authenticatedUser;
  const event = await eventStructureService.moveEvent(
    userId,
    request.params.festId,
    request.params.eventId,
    {
      newParentEventId: parentEventId,
      newFestId: festId,
      previousSiblingId: previousId,
      nextSiblingId: nextId,
    },
    extractRequestContext(request)
  );
  return response.status(200).json({ data: event });
}

/*
 * NO CURRENT CLIENT — see the route's comment. Retained for a future
 * multi-row drag; a single drop uses patchMoveEvent above.
 */
async function patchReorderEvents(request, response) {
  const { orderings } = request.body ?? {};

  if (!Array.isArray(orderings) || orderings.length === 0) {
    return invalid(response, { orderings: "must be a non-empty array" });
  }

  const details = {};
  const normalised = orderings.map((ordering, index) => {
    const row = ordering ?? {};
    if (!mongoose.Types.ObjectId.isValid(row.eventId)) {
      details[`orderings[${index}].eventId`] = "must be a valid id";
    }
    // Present-but-null is the top-level case; missing entirely is a bug in the
    // caller and is reported rather than guessed at.
    if (!("parentEventId" in row)) {
      details[`orderings[${index}].parentEventId`] = "is required (use null for top level)";
    } else if (row.parentEventId !== null && !mongoose.Types.ObjectId.isValid(row.parentEventId)) {
      details[`orderings[${index}].parentEventId`] = "must be a valid id or null";
    }

    const previousSiblingId = readOptionalObjectId(
      row.previousSiblingId,
      `orderings[${index}].previousSiblingId`,
      details
    );
    const nextSiblingId = readOptionalObjectId(
      row.nextSiblingId,
      `orderings[${index}].nextSiblingId`,
      details
    );

    return {
      eventId: String(row.eventId),
      parentEventId: row.parentEventId ? String(row.parentEventId) : null,
      previousSiblingId,
      nextSiblingId,
    };
  });

  if (Object.keys(details).length > 0) {
    return invalid(response, details);
  }

  const { userId } = request.authenticatedUser;
  const result = await eventStructureService.reorderEvents(
    userId,
    request.params.festId,
    normalised,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = { patchMoveEvent, patchReorderEvents };
