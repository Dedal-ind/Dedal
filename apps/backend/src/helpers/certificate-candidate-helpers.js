const { CERTIFICATE_TYPES, CERTIFICATE_STATUSES } = require("../constants/certificate-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

// Registration statuses that earn a certificate. confirmed counts as participation
// for the MVP: attendance tracking is not wired yet, so a confirmed seat qualifies.
const CERTIFICATE_TYPE_BY_REGISTRATION_STATUS = {
  [REGISTRATION_STATUSES.CONFIRMED]: CERTIFICATE_TYPES.PARTICIPATION,
  [REGISTRATION_STATUSES.ATTENDED]: CERTIFICATE_TYPES.PARTICIPATION,
  [REGISTRATION_STATUSES.WINNER_1ST]: CERTIFICATE_TYPES.WINNER_1ST,
  [REGISTRATION_STATUSES.WINNER_2ND]: CERTIFICATE_TYPES.WINNER_2ND,
  [REGISTRATION_STATUSES.WINNER_3RD]: CERTIFICATE_TYPES.WINNER_3RD,
};

const CERTIFICATE_TYPE_BY_STAFF_ROLE = {
  [STAFF_ROLES.COORDINATOR]: CERTIFICATE_TYPES.COORDINATOR,
  [STAFF_ROLES.VOLUNTEER]: CERTIFICATE_TYPES.VOLUNTEER,
  [STAFF_ROLES.ADMINISTRATOR]: CERTIFICATE_TYPES.ADMINISTRATOR,
};

const POSITION_BY_TYPE = {
  [CERTIFICATE_TYPES.WINNER_1ST]: "1st",
  [CERTIFICATE_TYPES.WINNER_2ND]: "2nd",
  [CERTIFICATE_TYPES.WINNER_3RD]: "3rd",
};

function formatFestDates(startsOn, endsOn) {
  const options = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
  const start = new Date(startsOn).toLocaleDateString("en-IN", options);
  const end = new Date(endsOn).toLocaleDateString("en-IN", options);
  return start === end ? start : `${start} – ${end}`;
}

function buildMetadata(user, { eventName = null, certificateType, role = null, fest, festDates }) {
  return {
    fullName: user.fullName || null,
    collegeName: user.collegeId?.commonName || null,
    usn: user.usn || null,
    eventName, festName: fest.festName, festDates,
    position: POSITION_BY_TYPE[certificateType] || null,
    role,
  };
}

function buildParticipantCandidates(registrations, eventById, usersById, fest, festId, festDates) {
  const candidates = [];
  for (const registration of registrations) {
    const certificateType = CERTIFICATE_TYPE_BY_REGISTRATION_STATUS[registration.status];
    const user = usersById.get(String(registration.userId));
    const event = eventById.get(String(registration.eventId));
    if (!certificateType || !user || !event) {
      continue;
    }
    candidates.push({
      userId: registration.userId,
      festId,
      eventId: registration.eventId,
      certificateType,
      status: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE,
      generatedAt: new Date(),
      metadata: buildMetadata(user, {
        eventName: event.eventName,
        certificateType,
        fest,
        festDates,
      }),
    });
  }
  return candidates;
}

function buildStaffCandidates(staffAssignments, usersById, fest, festId, festDates) {
  const candidates = [];
  for (const assignment of staffAssignments) {
    const certificateType = CERTIFICATE_TYPE_BY_STAFF_ROLE[assignment.role];
    const user = usersById.get(String(assignment.userId));
    // Defensive: production only ever passes active assignments (the query filters
    // them), but a revoked one must never earn an appreciation certificate.
    if (!certificateType || !user || assignment.status === STAFF_ASSIGNMENT_STATUSES.REVOKED) {
      continue;
    }
    candidates.push({
      userId: assignment.userId,
      festId,
      eventId: null,
      certificateType,
      status: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE,
      generatedAt: new Date(),
      metadata: buildMetadata(user, { certificateType, role: assignment.role, fest, festDates }),
    });
  }
  return candidates;
}

module.exports = {
  CERTIFICATE_TYPE_BY_REGISTRATION_STATUS,
  CERTIFICATE_TYPE_BY_STAFF_ROLE,
  POSITION_BY_TYPE,
  formatFestDates, buildMetadata, buildParticipantCandidates, buildStaffCandidates,
};
