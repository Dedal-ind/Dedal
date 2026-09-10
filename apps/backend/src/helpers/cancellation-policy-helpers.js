const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { findActiveAdministratorAssignment } = require("./administrator-helpers");
const { assignmentCoversEvent, isWithinAssignmentWindow } = require("./assignment-coverage-helpers");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { AUDIT_ACTIONS } = require("../constants/audit-log-constants");
const {
  CANCELLED_BY_ROLES,
  CANCELLABLE_SELF_STATUSES,
  CANCELLATION_FREEZE_MINUTES_BEFORE_EVENT,
  MINIMUM_CANCELLATION_REASON_LENGTH,
  MAXIMUM_CANCELLATION_REASON_LENGTH,
} = require("../constants/registration-constants");

const DEFAULT_SELF_REASON = "Cancelled by participant.";

const AUDIT_ACTION_BY_ROLE = {
  [CANCELLED_BY_ROLES.SELF]: AUDIT_ACTIONS.REGISTRATION_CANCELLED_BY_SELF,
  [CANCELLED_BY_ROLES.COORDINATOR]: AUDIT_ACTIONS.REGISTRATION_CANCELLED_BY_COORDINATOR,
  [CANCELLED_BY_ROLES.ADMIN]: AUDIT_ACTIONS.REGISTRATION_CANCELLED_BY_ADMIN,
};

/*
 * Which policy the caller gets, decided by their relationship to the row rather
 * than by which endpoint they reached — so a new surface cannot accidentally
 * grant a power the actor does not hold.
 *
 * Self wins over staff: an administrator cancelling their own registration is
 * still cancelling their own registration, and should not have to write a reason
 * about themselves. (An administrator cannot hold one anyway, per 12.5.1b — the
 * ordering is defensive.)
 */
async function resolveCancellationPolicy({ registration, event, fest, actorUserId }) {
  if (String(registration.userId) === String(actorUserId)) {
    return CANCELLED_BY_ROLES.SELF;
  }

  const administratorAssignment = await findActiveAdministratorAssignment(
    actorUserId,
    fest.hostCollegeId
  );
  if (administratorAssignment) {
    return CANCELLED_BY_ROLES.ADMIN;
  }

  /*
   * The window is re-checked here rather than trusted from the middleware: this
   * is the only gate on the service, and a coordinator whose assignment has
   * ended must not be able to strike a participant off an event they no longer
   * run.
   */
  const coordinatorAssignment = await StaffAssignmentModel.findOne({
    userId: actorUserId,
    festId: fest._id,
    role: STAFF_ROLES.COORDINATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();

  if (
    coordinatorAssignment &&
    (await assignmentCoversEvent(coordinatorAssignment, event._id)) &&
    isWithinAssignmentWindow(coordinatorAssignment, new Date())
  ) {
    return CANCELLED_BY_ROLES.COORDINATOR;
  }

  throw new ApplicationError(
    403,
    ERROR_CODES.PERMISSION_DENIED,
    "You cannot cancel this registration."
  );
}

/*
 * The participant's own bounds. A coordinator needs a roster that stops moving
 * before the event starts, and a row that has advanced into a bracket cannot be
 * withdrawn without leaving the bracket inconsistent — both are refused here and
 * neither applies to staff.
 */
function assertSelfCancellationAllowed(registration, event) {
  const freezeAt = new Date(
    event.startsAt.getTime() - CANCELLATION_FREEZE_MINUTES_BEFORE_EVENT * 60 * 1000
  );
  if (new Date() >= freezeAt) {
    throw new ApplicationError(
      400,
      ERROR_CODES.REGISTRATION_CANCELLATION_WINDOW_CLOSED,
      "Cancellation closed 2 hours before the event starts.",
      { freezeAt: freezeAt.toISOString(), startsAt: event.startsAt.toISOString() }
    );
  }

  if (!CANCELLABLE_SELF_STATUSES.includes(registration.status)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.REGISTRATION_CANCELLATION_STATUS_LOCKED,
      "This registration can no longer be self-cancelled because its status has advanced beyond confirmed or waitlisted.",
      { currentStatus: registration.status }
    );
  }
}

/*
 * Staff must say why — the reason is the audit trail, and the participant reads
 * it. A participant cancelling inside their own window owes nobody an
 * explanation, so their reason is optional and only length-capped.
 */
function resolveCancellationReason(policy, rawReason) {
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  if (policy === CANCELLED_BY_ROLES.SELF) {
    if (reason.length === 0) {
      return DEFAULT_SELF_REASON;
    }
    if (reason.length > MAXIMUM_CANCELLATION_REASON_LENGTH) {
      throw new ApplicationError(
        400,
        ERROR_CODES.CANCELLATION_REASON_REQUIRED,
        `Cancellation reason must be at most ${MAXIMUM_CANCELLATION_REASON_LENGTH} characters.`
      );
    }
    return reason;
  }

  if (
    reason.length < MINIMUM_CANCELLATION_REASON_LENGTH ||
    reason.length > MAXIMUM_CANCELLATION_REASON_LENGTH
  ) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CANCELLATION_REASON_REQUIRED,
      `Cancellation reason required (${MINIMUM_CANCELLATION_REASON_LENGTH}-${MAXIMUM_CANCELLATION_REASON_LENGTH} characters).`
    );
  }
  return reason;
}

module.exports = {
  resolveCancellationPolicy,
  assertSelfCancellationAllowed,
  resolveCancellationReason,
  AUDIT_ACTION_BY_ROLE,
  DEFAULT_SELF_REASON,
};
