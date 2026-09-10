const { EventModel } = require("../models/event-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { UserModel } = require("../models/user-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");

/*
 * The participant-facing CONTACT block on an event page: who to call.
 *
 * Exposes ONE resolved field per person —
 *   contactPhone = assignment.assignmentContactPhone || user.phoneNumber
 * — never the raw user.phoneNumber alongside (it is select:false on the user
 * model precisely because an earlier endpoint leaked it; see user-model.js).
 * Staff with neither an override nor a personal number are OMITTED entirely:
 * a contact list must never ship a broken tel: link.
 */
async function listEventStaffContacts(eventId) {
  const event = await EventModel.findById(eventId).select("festId").lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const assignments = await StaffAssignmentModel.find({
    festId: event.festId,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();

  // Fest-wide roles (empty eventIds) and roles covering this event or an
  // ancestor of it — the same rule every other coverage check uses.
  const coveringAssignments = [];
  for (const assignment of assignments) {
    if (await assignmentCoversEvent(assignment, eventId)) {
      coveringAssignments.push(assignment);
    }
  }

  const users = await UserModel.find({
    _id: { $in: coveringAssignments.map((assignment) => assignment.userId) },
  })
    // Deliberate, named request of the select:false field — resolved below and
    // never returned raw.
    .select("fullName +phoneNumber")
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  const contacts = [];
  for (const assignment of coveringAssignments) {
    const user = usersById.get(String(assignment.userId));
    const contactPhone = assignment.assignmentContactPhone || user?.phoneNumber || null;
    if (!contactPhone || !user?.fullName) {
      continue; // opted out or profile-incomplete — no broken entries
    }
    contacts.push({ fullName: user.fullName, role: assignment.role, contactPhone });
  }

  // Coordinators first — they are the escalation point; volunteers after.
  contacts.sort((first, second) =>
    first.role === second.role
      ? first.fullName.localeCompare(second.fullName)
      : first.role === STAFF_ROLES.COORDINATOR
        ? -1
        : 1
  );
  return { contacts };
}

module.exports = { listEventStaffContacts };
