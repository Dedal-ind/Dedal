const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { UserModel } = require("../models/user-model");
const { STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { EVENT_STATUSES } = require("../constants/event-constants");
const {
  CERTIFICATE_TYPE_BY_REGISTRATION_STATUS,
  buildParticipantCandidates,
  buildStaffCandidates,
} = require("./certificate-candidate-helpers");

/*
 * Which events may be certified. 'published' is included because it is the
 * TERMINAL state in practice: nothing in the system ever transitions an event
 * to ongoing/completed, so the old [completed, ongoing] filter matched zero
 * events and every certificate push silently produced 0. The date guard below
 * keeps the real-world gate: a published event only certifies once it has
 * ended (events with no endsAt are allowed through — the pusher knows).
 */
const CERTIFIABLE_EVENT_STATUSES = [
  EVENT_STATUSES.COMPLETED,
  EVENT_STATUSES.ONGOING,
  EVENT_STATUSES.PUBLISHED,
];

// A published event is certifiable only after its end; ongoing/completed are
// certifiable by status alone. Missing endsAt never blocks.
function isEventCertifiableNow(event, nowMs) {
  if (event.status !== EVENT_STATUSES.PUBLISHED) {
    return true;
  }
  if (!event.endsAt) {
    return true;
  }
  return new Date(event.endsAt).getTime() <= nowMs;
}

/* Every user who might earn a certificate, loaded once with their college name. */
async function loadUsersById(userIds) {
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("fullName usn collegeId")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

/*
 * Loads a fest's certifiable events, their qualifying registrations, and its active
 * staff, then assembles every certificate candidate the fest owes.
 */
async function buildCertificateCandidatesForFest(fest, festDates, scopeEventIds = null) {
  const eventFilter = { festId: fest._id, status: { $in: CERTIFIABLE_EVENT_STATUSES } };
  if (scopeEventIds) {
    eventFilter._id = { $in: scopeEventIds };
  }
  const nowMs = Date.now();
  const events = (await EventModel.find(eventFilter).select("eventName status endsAt").lean()).filter(
    (event) => isEventCertifiableNow(event, nowMs),
  );
  const eventById = new Map(events.map((event) => [String(event._id), event]));

  const registrations = await RegistrationModel.find({
    eventId: { $in: events.map((event) => event._id) },
    status: { $in: Object.keys(CERTIFICATE_TYPE_BY_REGISTRATION_STATUS) },
  }).select("userId eventId status").lean();

  /*
   * Staff certificates are fest-level (no eventId), so an event-scoped run must
   * not mint them — a coordinator generating for their event would otherwise
   * certify the whole fest's staff. They belong to the fest-wide run alone.
   */
  const staffAssignments = scopeEventIds
    ? []
    : await StaffAssignmentModel.find({
        festId: fest._id,
        status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
      }).select("userId role").lean();

  const userIds = [
    ...registrations.map((registration) => registration.userId),
    ...staffAssignments.map((assignment) => assignment.userId),
  ];
  const usersById = await loadUsersById(userIds);

  return [
    ...buildParticipantCandidates(registrations, eventById, usersById, fest, fest._id, festDates),
    ...buildStaffCandidates(staffAssignments, usersById, fest, fest._id, festDates),
  ];
}

module.exports = { CERTIFIABLE_EVENT_STATUSES, buildCertificateCandidatesForFest };
