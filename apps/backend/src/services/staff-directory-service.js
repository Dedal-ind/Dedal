const mongoose = require("mongoose");

const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { findFestOrThrow } = require("../helpers/assert-administrator-of-fest");
const { hasAdministratorAuthority } = require("../helpers/administrator-helpers");
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
  const hasAdministratorRights = await hasAdministratorAuthority(userId, fest.hostCollegeId);
  if (staffAssignment || hasAdministratorRights) {
    return { canSeeContacts: true, isStaffTier: true };
  }

  const registration = await RegistrationModel.findOne({
    userId,
    eventId: { $in: festEventIds },
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("_id")
    .lean();
  return { canSeeContacts: Boolean(registration), isStaffTier: false };
}

/*
 * A staff person as seen by the caller.
 *
 * WHO IS RUNNING THIS IS PUBLIC; HOW TO REACH THEM IS NOT.
 *
 * The directory used to refuse the whole request unless the caller held a
 * confirmed registration in the fest — a visitor deciding whether to enter got
 * "Register for an event under this fest to view its crew directory", which is
 * backwards: knowing who oversees an event is part of deciding whether to
 * register for it, not a reward for having done so.
 *
 * So the roster is open to any signed-in visitor (browsing a fest already
 * requires signing in), and the CONTACT DETAILS are what is tiered. Names,
 * roles and the events each person covers are always returned. A personal
 * phone number and email are returned only to fest staff and to confirmed
 * participants.
 *
 * That split is the point. Publishing student volunteers' personal mobile
 * numbers to every signed-in stranger is a different decision from listing who
 * is in charge, and only the second one was asked for. A fest whose crew want
 * their numbers out of the participant tier too needs assignment-level contact
 * fields rather than a narrower directory.
 */
function buildStaffEntry(assignment, { isStaffTier, canSeeContacts }) {
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
  /*
   * ABSENT, not null-with-a-flag. The client hides a contact action it has no
   * value for, so omitting the field is what makes the card render correctly
   * for a visitor — and a number that is never serialised cannot leak from a
   * response somebody inspects.
   */
  if (canSeeContacts) {
    entry.phoneNumber = user.phoneNumber || null;
    entry.emailAddress = user.emailAddress || null;
  }
  // Retained so a caller can still tell the two tiers apart if it needs to.
  entry.isStaffView = isStaffTier;
  entry.canSeeContacts = canSeeContacts;
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

  /*
   * No refusal here any more. Every signed-in caller gets the roster; the tier
   * decides only whether it carries contact details. See buildStaffEntry.
   */
  const { canSeeContacts, isStaffTier } = await resolveDirectoryAccess(userId, fest, festEventIds);

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
        staff.push(buildStaffEntry(assignment, { isStaffTier, canSeeContacts }));
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
