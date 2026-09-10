const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { findActiveAdministratorAssignment } = require("../helpers/administrator-helpers");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const {
  isWithinAssignmentWindow,
  assignmentCoversEvent,
} = require("../helpers/assignment-coverage-helpers");

// Methods that mutate state. Reads (GET/HEAD) never require an in-window assignment.
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/*
 * A coordinator covers an event-scoped route when one of their active/revoked
 * assignments covers the event — hierarchy-aware, so a coordinator of a vertical
 * covers its sub-events. Coverage is resolved in JS (not a Mongo $or on eventIds)
 * precisely so the ancestor walk applies. Status/window are checked by the caller,
 * so an expired-but-active assignment is still returned (reads must stay open).
 */
async function findCoveringCoordinatorAssignment(userId, festId, eventId, status) {
  const assignments = await StaffAssignmentModel.find({
    userId,
    festId,
    role: STAFF_ROLES.COORDINATOR,
    status,
  }).lean();
  if (eventId === undefined) {
    return assignments[0] || null;
  }
  for (const assignment of assignments) {
    if (await assignmentCoversEvent(assignment, eventId)) {
      return assignment;
    }
  }
  return null;
}

/*
 * The coordinator/admin gate. Administrators of the fest's host college pass
 * unconditionally. A coordinator passes when they have an active assignment that
 * covers this route; on a WRITE, that assignment must also be inside its validity
 * window right now (ASSIGNMENT_EXPIRED otherwise), and a revoked assignment yields
 * ASSIGNMENT_REVOKED. Reads stay open to expired coordinators so they can still
 * look at the fest afterwards. A missing fest/event resolves to PERMISSION_DENIED
 * rather than a 404, so the gate cannot be used to probe which ids exist.
 */
async function requireCoordinatorOrAdminMiddleware(request, response, next) {
  try {
    const { userId } = request.authenticatedUser;
    const { festId, eventId } = request.params;
    const isEventScoped = eventId !== undefined;
    const idsValid =
      mongoose.Types.ObjectId.isValid(festId) &&
      (!isEventScoped || mongoose.Types.ObjectId.isValid(eventId));
    if (!idsValid) {
      throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot manage this event.");
    }

    const fest = await FestModel.findById(festId).select("hostCollegeId").lean();
    if (fest) {
      const administratorAssignment = await findActiveAdministratorAssignment(userId, fest.hostCollegeId);
      if (administratorAssignment) {
        request.staffAssignment = administratorAssignment;
        request.isAdministrator = true;
        return next();
      }
    }

    const scopedEventId = isEventScoped ? eventId : undefined;
    const isWrite = WRITE_METHODS.has(request.method);
    const activeAssignment = await findCoveringCoordinatorAssignment(
      userId,
      festId,
      scopedEventId,
      STAFF_ASSIGNMENT_STATUSES.ACTIVE
    );

    if (activeAssignment) {
      if (isWrite && !isWithinAssignmentWindow(activeAssignment, new Date())) {
        throw new ApplicationError(
          403,
          ERROR_CODES.ASSIGNMENT_EXPIRED,
          "Your assignment window has ended; you can no longer make changes here."
        );
      }
      request.staffAssignment = activeAssignment;
      request.isAdministrator = false;
      return next();
    }

    if (isWrite) {
      const revokedAssignment = await findCoveringCoordinatorAssignment(
        userId,
        festId,
        scopedEventId,
        STAFF_ASSIGNMENT_STATUSES.REVOKED
      );
      if (revokedAssignment) {
        throw new ApplicationError(
          403,
          ERROR_CODES.ASSIGNMENT_REVOKED,
          "Your assignment has been revoked; you can no longer make changes here."
        );
      }
    }

    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot manage this event.");
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireCoordinatorOrAdminMiddleware };
