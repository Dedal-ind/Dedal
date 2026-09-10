const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ASSIGNMENT_STATUSES, STAFF_ROLES } = require("../constants/staff-constants");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { createAutoShiftsForVolunteerAssignment } = require("../helpers/auto-shift-helpers");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { computeAssignmentValidityWindow } = require("../helpers/assignment-validity-window");
const {
  findOrCreateUserByEmailAddress,
  loadFestEventsOrThrow,
  toObjectId,
} = require("../helpers/staff-assignment-helpers");
const { loadRosterReferenceMaps, buildStaffRoster } = require("../helpers/staff-roster-helpers");
const { recordAuditLog } = require("./audit-log-service");

const ASSIGN_POPULATE = [
  { path: "userId", select: "emailAddress fullName emailVerifiedAt isProfileComplete" },
  { path: "eventIds", select: "eventName status" },
];

function mergeEventIds(existingIds, incomingIds) {
  const seen = new Set(existingIds.map(String));
  const merged = [...existingIds];
  for (const id of incomingIds) {
    if (!seen.has(String(id))) {
      seen.add(String(id));
      merged.push(id);
    }
  }
  return merged;
}

const earlier = (first, second) => (!first || (second && second < first) ? second || first : first);
const later = (first, second) => (!first || (second && second > first) ? second || first : first);

/*
 * Event-first assignment. Looks the person up by email (creating a pending user if
 * new), verifies the events belong to the fest, then either merges into the
 * person's existing active assignment for this role (union of eventIds, widened
 * window) or creates a fresh one. Administrator-only; audited on success.
 */
async function assignStaffToEvents(assignerUserId, festId, payload, context = {}) {
  const { fest } = await assertAdministratorOfFest(assignerUserId, festId);
  const { user: invitee } = await findOrCreateUserByEmailAddress(payload.emailAddress);
  if (invitee._id.equals(toObjectId(assignerUserId))) {
    throw new ApplicationError(400, ERROR_CODES.CANNOT_ASSIGN_SELF, "You cannot assign yourself.");
  }

  const events = await loadFestEventsOrThrow(fest._id, payload.eventIds);
  const derived = computeAssignmentValidityWindow(events, payload.role);
  const validFrom = payload.validFrom || derived.validFrom;
  const validTo = payload.validTo || derived.validTo;
  const eventObjectIds = events.map((event) => event._id);

  const existing = await StaffAssignmentModel.findOne({
    userId: invitee._id,
    festId: fest._id,
    role: payload.role,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });

  let assignment;
  if (existing) {
    /*
     * MAIN GATE DOES NOT MERGE. Every other assignment widens: assigning someone
     * to a second event adds it to eventIds, because there is one active row per
     * (user, fest, role) and more events is more reach of the same kind.
     *
     * The gate is a different kind. Merging it in would mean eventIds stays
     * non-empty while allowedCheckpointTypes becomes ['gate'] — an assignment
     * that names events but may only scan gates, i.e. reach at neither. And
     * merging the other way (an event added to an existing gate assignment)
     * would silently widen a deliberately gate-only volunteer to that event's
     * door. So the gate REPLACES the scope rather than joining it, and the admin
     * gets one unambiguous answer to "what does this person do".
     */
    if (payload.isMainGateAssignment) {
      existing.eventIds = [];
      existing.allowedCheckpointTypes = payload.allowedCheckpointTypes;
      existing.validFrom = validFrom;
      existing.validTo = validTo;
    } else {
      existing.eventIds = mergeEventIds(existing.eventIds, eventObjectIds);
      existing.validFrom = earlier(existing.validFrom, validFrom);
      existing.validTo = later(existing.validTo, validTo);
      if (payload.allowedCheckpointTypes && payload.allowedCheckpointTypes.length > 0) {
        existing.allowedCheckpointTypes = payload.allowedCheckpointTypes;
      }
    }
    if (payload.assignmentContactPhone) {
      existing.assignmentContactPhone = payload.assignmentContactPhone;
    }
    assignment = await existing.save();
  } else {
    assignment = await StaffAssignmentModel.create({
      userId: invitee._id,
      festId: fest._id,
      role: payload.role,
      eventIds: eventObjectIds,
      validFrom,
      validTo,
      /*
       * Previously dropped on this path: the validator parsed
       * allowedCheckpointTypes and the service never wrote it, so every
       * event-first assignment landed unrestricted whatever the admin picked.
       * Main Gate depends on it being honoured.
       */
      allowedCheckpointTypes: payload.allowedCheckpointTypes || [],
      assignmentContactPhone: payload.assignmentContactPhone || null,
      assignedByUserId: assignerUserId,
    });
  }

  // Same auto-shift floor as the fest-level assign path; the idempotency check
  // inside makes the widened-existing-assignment case safe (covered events that
  // already carry a shift are skipped).
  if (assignment.role === STAFF_ROLES.VOLUNTEER) {
    await createAutoShiftsForVolunteerAssignment({
      assignment,
      fest,
      events,
      actorUserId: assignerUserId,
      context,
    });
  }

  await recordAuditLog({
    actorUserId: assignerUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.STAFF_ASSIGNED,
    entityType: AUDIT_ENTITY_TYPES.STAFF_ASSIGNMENT,
    entityId: assignment._id,
    afterState: {
      role: assignment.role,
      eventIds: assignment.eventIds.map(String),
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
    },
    ...context,
  });

  await assignment.populate(ASSIGN_POPULATE);
  return assignment.toJSON();
}

async function getFestStaffRoster(festId) {
  const assignments = await StaffAssignmentModel.find({ festId }).lean();
  const maps = await loadRosterReferenceMaps(assignments);
  return { staff: buildStaffRoster(assignments, maps, new Date()) };
}

/* All assignments that cover this event — named explicitly, or fest-wide (empty eventIds). */
async function getEventStaffRoster(festId, eventId) {
  const assignments = await StaffAssignmentModel.find({
    festId,
    $or: [{ eventIds: eventId }, { eventIds: { $size: 0 } }],
  }).lean();
  const maps = await loadRosterReferenceMaps(assignments);
  return { staff: buildStaffRoster(assignments, maps, new Date()) };
}

module.exports = { assignStaffToEvents, getFestStaffRoster, getEventStaffRoster };
