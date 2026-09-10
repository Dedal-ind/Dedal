const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ASSIGNMENT_STATUSES, STAFF_ROLES } = require("../constants/staff-constants");
const { createAutoShiftsForVolunteerAssignment } = require("../helpers/auto-shift-helpers");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { computeAssignmentValidityWindow } = require("../helpers/assignment-validity-window");
const {
  findOrCreateUserByEmailAddress,
  loadFestEventsOrThrow,
  compareAssignments,
  isDuplicateAssignmentError,
  buildAlreadyExistsError,
  toObjectId,
} = require("../helpers/staff-assignment-helpers");
const { sendAssignmentInvitation, sendAssignmentRevocation } = require("./email-service");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

const EMAIL_DELIVERY_WARNING = "email_delivery_failed";

/*
 * The UI reads each assignment's invitee, fest, and events by name rather than by
 * id. The endpoints populate exactly the display fields the screens use — never
 * the whole related document — so no extra round-trip is needed.
 */
const TEAM_MEMBER_FIELDS = "emailAddress fullName emailVerifiedAt isProfileComplete";
const EVENT_SUMMARY_FIELDS = "eventName status";
const FEST_SUMMARY_FIELDS = "festName status bannerImageUrl";

// festId carries no ref in the schema, so its populate names the model explicitly.
const FEST_POPULATE = { path: "festId", select: FEST_SUMMARY_FIELDS, model: "Fest" };
/*
 * The signed-in user's own assignments carry the college name so the "who am I"
 * badge can read "College Admin — RVCE" without a second round-trip. Named
 * explicitly for the same reason as the fest populate. Null for the
 * platform-admin row, which is scoped to no college.
 */
const COLLEGE_POPULATE = { path: "collegeId", select: "commonName collegeName", model: "College" };
const TEAM_MEMBER_POPULATE = [
  { path: "userId", select: TEAM_MEMBER_FIELDS },
  { path: "eventIds", select: EVENT_SUMMARY_FIELDS },
];

// Mirrors requestOtp: a delivery failure is a warning, not a rollback.
function withEmailWarning(assignment, wasEmailSent) {
  const responseData = assignment.toJSON();
  if (!wasEmailSent) {
    responseData.warning = EMAIL_DELIVERY_WARNING;
  }
  return responseData;
}

async function assignStaffMember(assignerUserId, festId, payload, context = {}) {
  const { fest } = await assertAdministratorOfFest(assignerUserId, festId);
  const { user: invitee } = await findOrCreateUserByEmailAddress(payload.emailAddress);

  if (invitee._id.equals(toObjectId(assignerUserId))) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CANNOT_ASSIGN_SELF,
      "You cannot assign yourself to a fest you administer."
    );
  }

  const events = await loadFestEventsOrThrow(fest._id, payload.eventIds);
  // Role-aware: a coordinator's console opens two days before the first event.
  const { validFrom, validTo } = computeAssignmentValidityWindow(events, payload.role);

  let assignment;
  try {
    assignment = await StaffAssignmentModel.create({
      userId: invitee._id,
      festId: fest._id,
      role: payload.role,
      eventIds: events.map((event) => event._id),
      validFrom,
      validTo,
      allowedCheckpointTypes: payload.allowedCheckpointTypes || [],
      assignmentContactPhone: payload.assignmentContactPhone || null,
      assignedByUserId: assignerUserId,
    });
  } catch (error) {
    if (!isDuplicateAssignmentError(error)) {
      throw error;
    }
    throw await buildAlreadyExistsError(invitee._id, fest._id, payload);
  }

  /*
   * Volunteers get a default shift per covered event (or at the main gate for
   * a fest-wide role) so "assigned but never scheduled" stops being a state
   * the admin can forget in. Coordinators deliberately do NOT: they have no
   * shifts — their access is the ACTIVE assignment itself.
   */
  if (assignment.role === STAFF_ROLES.VOLUNTEER) {
    await createAutoShiftsForVolunteerAssignment({
      assignment,
      fest,
      events,
      actorUserId: assignerUserId,
      context,
    });
  }

  const wasEmailSent = await sendAssignmentInvitation({
    emailAddress: invitee.emailAddress,
    role: assignment.role,
    festName: fest.festName,
    festBannerImageUrl: fest.bannerImageUrl ?? null,
  });

  await recordAuditLog({
    actorUserId: assignerUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.STAFF_ASSIGNED,
    entityType: AUDIT_ENTITY_TYPES.STAFF_ASSIGNMENT,
    entityId: assignment._id,
    afterState: { role: assignment.role, eventIds: assignment.eventIds, email: invitee.emailAddress },
    ...context,
  });

  // Same shape the team list returns, so the client renders it without a refetch.
  await assignment.populate(TEAM_MEMBER_POPULATE);
  return withEmailWarning(assignment, wasEmailSent);
}

async function listStaffAssignmentsForFest(assignerUserId, festId) {
  const { fest } = await assertAdministratorOfFest(assignerUserId, festId);
  const assignments = await StaffAssignmentModel.find({ festId: fest._id })
    .populate(TEAM_MEMBER_POPULATE[0].path, TEAM_MEMBER_FIELDS)
    .populate(TEAM_MEMBER_POPULATE[1].path, EVENT_SUMMARY_FIELDS);

  /*
   * Worked hours, computed from shift windows in ONE aggregation for the whole
   * fest — a per-row query would be eighty round trips to render one column.
   * Only volunteers hold shifts, so every other role reports null rather than
   * 0: "no shifts to work" and "worked nothing" are different statements.
   */
  const { getWorkedHoursByUserId } = require("./volunteer-hours-service");
  const workedHoursByUserId = await getWorkedHoursByUserId(fest._id);

  return assignments.sort(compareAssignments).map((assignment) => {
    const json = assignment.toJSON();
    json.totalHoursWorked =
      assignment.role === STAFF_ROLES.VOLUNTEER
        ? workedHoursByUserId.get(String(assignment.userId?._id ?? assignment.userId)) ?? 0
        : null;
    return json;
  });
}

async function findAssignmentOrThrow(festId, assignmentId) {
  const assignment = toObjectId(assignmentId)
    ? await StaffAssignmentModel.findOne({ _id: assignmentId, festId })
    : null;
  if (!assignment) {
    throw new ApplicationError(404, ERROR_CODES.ASSIGNMENT_NOT_FOUND, "Assignment not found.");
  }
  return assignment;
}

async function revokeStaffAssignment(assignerUserId, festId, assignmentId, reason = null, context = {}) {
  const { fest } = await assertAdministratorOfFest(assignerUserId, festId);
  const assignment = await findAssignmentOrThrow(fest._id, assignmentId);

  // Idempotent: a second revoke is a no-op, and sends no second email.
  if (assignment.status === STAFF_ASSIGNMENT_STATUSES.REVOKED) {
    return assignment.toJSON();
  }

  const beforeState = { role: assignment.role, status: assignment.status };
  assignment.status = STAFF_ASSIGNMENT_STATUSES.REVOKED;
  assignment.revokedAt = new Date();
  assignment.revokedByUserId = assignerUserId;
  assignment.revocationReason = reason;
  await assignment.save();

  await recordAuditLog({
    actorUserId: assignerUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.STAFF_REVOKED,
    entityType: AUDIT_ENTITY_TYPES.STAFF_ASSIGNMENT,
    entityId: assignment._id,
    beforeState,
    afterState: { status: assignment.status },
    ...context,
  });

  await assignment.populate("userId", "emailAddress");
  const wasEmailSent = await sendAssignmentRevocation({
    emailAddress: assignment.userId.emailAddress,
    role: assignment.role,
    festName: fest.festName,
    festBannerImageUrl: fest.bannerImageUrl ?? null,
    reason,
  });

  assignment.depopulate("userId");
  return withEmailWarning(assignment, wasEmailSent);
}

// A revoked assignment grants nothing, so the holder is not shown it.
async function listMyStaffAssignments(userId) {
  const assignments = await StaffAssignmentModel.find({
    userId,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .sort({ createdAt: -1 })
    .populate(FEST_POPULATE)
    .populate(COLLEGE_POPULATE)
    .populate("eventIds", EVENT_SUMMARY_FIELDS);
  return assignments.map((assignment) => assignment.toJSON());
}

module.exports = {
  assignStaffMember,
  listStaffAssignmentsForFest,
  revokeStaffAssignment,
  listMyStaffAssignments,
};
