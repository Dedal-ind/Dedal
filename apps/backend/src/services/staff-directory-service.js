const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { findFestOrThrow } = require("../helpers/assert-administrator-of-fest");
const { hasAdministratorAuthority } = require("../helpers/administrator-helpers");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");

/*
 * THE DIRECTORY IS FOR PEOPLE WHO ARE AT THE FEST. Everyone else gets a 403.
 *
 * This rule has been both ways round, so the reasoning belongs here rather than
 * in a commit message. It was originally gated; then opened, on the argument
 * that knowing who oversees an event is part of deciding whether to register
 * for it, with only the phone numbers and emails tiered; it is now gated again,
 * deliberately and with that trade-off understood.
 *
 * What settles it: this is a list of named students, most of them volunteers,
 * annotated with where they will be and when. The open version withheld their
 * contact details from strangers but still published the roster itself to any
 * signed-in account, and an account costs an email address. "Who is running
 * this" is a fair question from someone deciding whether to attend; it is not
 * fair enough to hand a stranger the shift map of forty named undergraduates.
 *
 * Who passes:
 *   - anyone with an active coordinator or volunteer assignment in the fest;
 *   - an administrator of the host college, and the platform owner through
 *     hasAdministratorAuthority;
 *   - a participant holding at least one CONFIRMED registration in the fest.
 *
 * Confirmed specifically, not "live": a pendingPayment row is an intent to
 * attend, not attendance, and it is trivially self-issued by starting a
 * checkout and abandoning it. That would make the gate decorative.
 */
async function assertDirectoryAccess(userId, fest, festEventIds) {
  const staffAssignment = await StaffAssignmentModel.findOne({
    userId,
    festId: fest._id,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();
  if (staffAssignment) {
    return;
  }

  if (await hasAdministratorAuthority(userId, fest.hostCollegeId)) {
    return;
  }

  const registration = await RegistrationModel.findOne({
    userId,
    eventId: { $in: festEventIds },
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("_id")
    .lean();
  if (registration) {
    return;
  }

  throw new ApplicationError(
    403,
    ERROR_CODES.PERMISSION_DENIED,
    "Register for an event in this fest to see its crew directory."
  );
}

/*
 * A DIRECTORY ENTRY, AND NOTHING MORE THAN ONE.
 *
 * Four fields: who they are, what they do, and the two ways to reach them. The
 * assigned events come from the group this entry sits in, so they are not
 * repeated here.
 *
 * What is deliberately NOT returned, though the assignment and user documents
 * both carry it: the crew member's userId, their participantId, and their
 * profilePictureUrl. This is a list of people to contact, not a set of links
 * into their profiles, and an id that is never serialised cannot be used to
 * enumerate anything. The screen renders an initials monogram where the photo
 * used to go.
 *
 * phoneNumber and emailAddress are plain fields again rather than conditionally
 * attached: with the gate above, every caller who reaches this point is
 * entitled to them, so there is no longer a second tier to express. `null`
 * means the crew member has not given us that detail - a real distinction the
 * screen uses to hide one icon rather than both.
 */
function buildStaffEntry(assignment) {
  const user = assignment.userId || {};
  return {
    fullName: user.fullName || null,
    role: assignment.role,
    phoneNumber: user.phoneNumber || null,
    emailAddress: user.emailAddress || null,
  };
}

function compareByName(first, second) {
  return String(first.fullName ?? "").localeCompare(String(second.fullName ?? ""));
}

/*
 * Coordinators and volunteers grouped by the events they cover, hierarchy-aware:
 * a coordinator on a parent event appears under every descendant. An optional
 * eventId narrows the directory to that one event's staff. Only events with at
 * least one staff member are returned, sorted by name.
 *
 * Within a group, coordinators come before volunteers and each role is sorted
 * alphabetically - the reader is scanning for a name or for "who is in charge
 * here", and both questions are answered faster by a stable order than by
 * whatever order the assignments happened to be written in.
 */
async function getStaffDirectory(userId, festId, eventId = null) {
  const fest = await findFestOrThrow(festId);

  const allEvents = await EventModel.find({ festId: fest._id })
    .select("eventName parentEventId")
    .lean();
  const festEventIds = allEvents.map((event) => event._id);

  await assertDirectoryAccess(userId, fest, festEventIds);

  let events = allEvents;
  if (eventId) {
    events = allEvents.filter((event) => String(event._id) === String(eventId));
  }

  const assignments = await StaffAssignmentModel.find({
    festId: fest._id,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).populate("userId", "fullName emailAddress +phoneNumber");

  const groups = [];
  for (const event of events) {
    const coordinators = [];
    const volunteers = [];
    for (const assignment of assignments) {
      if (await assignmentCoversEvent(assignment, event._id)) {
        const entry = buildStaffEntry(assignment);
        if (entry.role === STAFF_ROLES.COORDINATOR) {
          coordinators.push(entry);
        } else {
          volunteers.push(entry);
        }
      }
    }
    if (coordinators.length > 0 || volunteers.length > 0) {
      groups.push({
        /*
         * The EVENT's id, which is not a crew member's id. It is kept as the
         * one stable key the screen can render sections against; two events in
         * a fest may legitimately share a name, and keying on the name would
         * collapse them into one section.
         */
        eventId: String(event._id),
        eventName: event.eventName,
        staff: [...coordinators.sort(compareByName), ...volunteers.sort(compareByName)],
      });
    }
  }

  groups.sort((first, second) => String(first.eventName).localeCompare(String(second.eventName)));
  return groups;
}

module.exports = { getStaffDirectory };
