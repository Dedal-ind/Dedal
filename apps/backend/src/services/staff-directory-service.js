const mongoose = require("mongoose");

const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { findFestOrThrow } = require("../helpers/assert-administrator-of-fest");
const { findActiveAdministratorAssignment } = require("../helpers/administrator-helpers");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");

/*
 * Access is data-scoped, not a role gate: anyone with a confirmed registration in
 * the fest OR an active assignment in it may read the directory. Staff (any active
 * assignment, including administrator) see phone numbers; everyone else does not.
 */
async function resolveDirectoryAccess(userId, fest, festEventIds) {
  const staffAssignment = await StaffAssignmentModel.findOne({
    userId,
    festId: fest._id,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();
  const administratorAssignment = await findActiveAdministratorAssignment(userId, fest.hostCollegeId);
  if (staffAssignment || administratorAssignment) {
    return { hasAccess: true, isStaffTier: true };
  }

  const registration = await RegistrationModel.findOne({
    userId,
    eventId: { $in: festEventIds },
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("_id")
    .lean();
  return { hasAccess: Boolean(registration), isStaffTier: false };
}

/*
 * A staff person as seen by the caller.
 *
 * CONTACT DETAILS ARE NOW SHOWN TO PARTICIPANTS TOO, not just to staff. The
 * directory exists so a participant can reach the person running their event;
 * without a number or an address it lists names they cannot act on.
 *
 * The trade is deliberate and worth stating: every confirmed participant of the
 * fest can now see every coordinator's and volunteer's phone number and email.
 * The registration gate in resolveDirectoryAccess is the only thing limiting who
 * that is, so it is the control that matters — a fest whose crew do not want
 * their personal numbers published needs assignment-level contact fields rather
 * than a narrower directory.
 */
function buildStaffEntry(assignment, isStaffTier) {
  const user = assignment.userId || {};
  const entry = {
    userId: String(user._id),
    fullName: user.fullName || null,
    role: assignment.role,
    participantId: user.participantId || null,
    // Null for anyone who has not signed in with Google; the directory falls back
    // to an initials monogram rather than showing a gap.
    profilePictureUrl: user.profilePictureUrl || null,
  };
  entry.phoneNumber = user.phoneNumber || null;
  entry.emailAddress = user.emailAddress || null;
  // Retained so a caller can still tell the two tiers apart if it needs to.
  entry.isStaffView = isStaffTier;
  return entry;
}

/*
 * Coordinators and volunteers grouped by the events they cover, hierarchy-aware:
 * a coordinator on a parent event appears under every descendant. An optional
 * eventId narrows the directory to that one event's staff. Only events with at
 * least one staff member are returned, sorted by name.
 */
async function getStaffDirectory(userId, festId, eventId = null) {
  const fest = await findFestOrThrow(festId);

  const allEvents = await EventModel.find({ festId: fest._id })
    .select("eventName parentEventId")
    .lean();
  const festEventIds = allEvents.map((event) => event._id);

  const { hasAccess, isStaffTier } = await resolveDirectoryAccess(userId, fest, festEventIds);
  if (!hasAccess) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot view this directory.");
  }

  let events = allEvents;
  if (eventId) {
    events = allEvents.filter((event) => String(event._id) === String(eventId));
  }

  const assignments = await StaffAssignmentModel.find({
    festId: fest._id,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).populate("userId", "fullName participantId profilePictureUrl emailAddress +phoneNumber");

  const groups = [];
  for (const event of events) {
    const staff = [];
    for (const assignment of assignments) {
      if (await assignmentCoversEvent(assignment, event._id)) {
        staff.push(buildStaffEntry(assignment, isStaffTier));
      }
    }
    if (staff.length > 0) {
      groups.push({
        eventId: String(event._id),
        eventName: event.eventName,
        parentEventId: event.parentEventId ? String(event.parentEventId) : null,
        staff,
      });
    }
  }

  groups.sort((first, second) => String(first.eventName).localeCompare(String(second.eventName)));
  return groups;
}

module.exports = { getStaffDirectory };
