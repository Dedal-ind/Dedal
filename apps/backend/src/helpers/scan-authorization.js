const { FestModel } = require("../models/fest-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { findActiveAdministratorAssignment } = require("./administrator-helpers");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { assignmentCoversCheckpoint, isWithinAssignmentWindow } = require("./assignment-coverage-helpers");
const { CHECKPOINT_TYPES } = require("../constants/scan-constants");
const {
  resolveVolunteerCheckpointAuthorization,
  VOLUNTEER_AUTHORIZATION,
} = require("./scan-decision-helpers");

/*
 * AUTHORIZED — the scanner may operate this checkpoint; proceed to the pass
 * decision. NO_ACTIVE_SHIFT — a scheduled volunteer with no active shift here now;
 * the scan is recorded as rejectedNoActiveShift rather than thrown as a 403.
 */
const SCAN_AUTHORIZATION_OUTCOMES = { AUTHORIZED: "authorized", NO_ACTIVE_SHIFT: "no_active_shift" };

/*
 * A volunteer may be scoped to specific checkpoint types (a food-counter volunteer,
 * a gate volunteer). An empty array is unrestricted — every type — for backward
 * compatibility with assignments created before the field existed. Coordinators and
 * administrators never reach here; they are type-unrestricted by definition.
 */
function volunteerAllowedAtCheckpointType(assignment, checkpoint) {
  const allowed = assignment.allowedCheckpointTypes || [];
  return allowed.length === 0 || allowed.includes(checkpoint.checkpointType);
}

/*
 * THE GATE IS NOT COVERED BY AN EVENT-SCOPED VOLUNTEER.
 *
 * assignmentCoversCheckpoint answers true for every GATE and every OFFER
 * regardless of the assignment's events, and that is correct for what it is used
 * for elsewhere (roster visibility, the shift checkpoint picker: a coordinator
 * scheduling volunteers needs to SEE the gate). It is too permissive as a scan
 * gate for a volunteer, because it makes "volunteer on the Robotics door" and
 * "volunteer on the Main Gate" the same authority — the Robotics volunteer could
 * stand at the entrance and admit the campus.
 *
 * So the two are separated here, at the scan, and only for volunteers:
 *   · a FEST-WIDE volunteer (eventIds empty) is the gate/campus-wide role;
 *   · an EVENT-SCOPED volunteer works their events' doors and counters, not the
 *     gate.
 *
 * Coordinators and administrators are untouched — a coordinator running an event
 * legitimately walks the whole site, and the shift path (which names ONE
 * checkpoint) already scopes volunteers who have shifts. This only closes the
 * FALLBACK path, i.e. a volunteer with no shifts at all.
 */
function volunteerAssignmentReachesGate(assignment, checkpoint) {
  if (checkpoint.checkpointType !== CHECKPOINT_TYPES.GATE) {
    return true;
  }
  return !assignment.eventIds || assignment.eventIds.length === 0;
}

async function isAdministratorOfCheckpoint(scannerUserId, checkpoint) {
  const fest = await FestModel.findById(checkpoint.festId).select("hostCollegeId").lean();
  if (!fest) {
    return false;
  }
  return Boolean(await findActiveAdministratorAssignment(scannerUserId, fest.hostCollegeId));
}

/*
 * Who may operate a checkpoint. Administrators scan unconditionally. A coordinator
 * needs an active assignment that covers the checkpoint and is in-window — unchanged.
 * A volunteer is shift-driven once they have any shift in the fest; before that,
 * their staffAssignment window governs as before (the non-breaking fallback).
 */
async function resolveScanAuthorization(scannerUserId, checkpoint, now) {
  if (await isAdministratorOfCheckpoint(scannerUserId, checkpoint)) {
    return SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED;
  }

  const assignments = await StaffAssignmentModel.find({
    userId: scannerUserId,
    festId: checkpoint.festId,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();

  for (const assignment of assignments) {
    if (
      assignment.role === STAFF_ROLES.COORDINATOR &&
      isWithinAssignmentWindow(assignment, now) &&
      (await assignmentCoversCheckpoint(assignment, checkpoint))
    ) {
      return SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED;
    }
  }

  const volunteerAssignments = assignments.filter(
    (assignment) => assignment.role === STAFF_ROLES.VOLUNTEER
  );
  if (volunteerAssignments.length > 0) {
    const decision = await resolveVolunteerCheckpointAuthorization({
      userId: scannerUserId,
      festId: checkpoint.festId,
      checkpointId: checkpoint._id,
      now,
    });
    if (decision === VOLUNTEER_AUTHORIZATION.AUTHORIZED_VIA_SHIFT) {
      return SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED;
    }
    if (decision === VOLUNTEER_AUTHORIZATION.DENIED) {
      return SCAN_AUTHORIZATION_OUTCOMES.NO_ACTIVE_SHIFT;
    }
    for (const assignment of volunteerAssignments) {
      if (
        isWithinAssignmentWindow(assignment, now) &&
        (await assignmentCoversCheckpoint(assignment, checkpoint))
      ) {
        /*
         * The assignment covers the checkpoint's event, but a type-scoped volunteer
         * (foodCounter only, gate only) at the wrong type is a misconfigured
         * assignment — an admin error — so it is a hard 403, not a recorded scan
         * rejection.
         */
        if (!volunteerAllowedAtCheckpointType(assignment, checkpoint)) {
          throw new ApplicationError(
            403,
            ERROR_CODES.PERMISSION_DENIED,
            "You are not authorized for this checkpoint type."
          );
        }
        /*
         * Same shape of refusal as the type check above, and for the same reason:
         * an event volunteer standing at the Main Gate is a misrouted person, not
         * a bad pass, so it is a 403 telling them where they belong rather than a
         * recorded scan rejection against the participant in front of them.
         */
        if (!volunteerAssignmentReachesGate(assignment, checkpoint)) {
          throw new ApplicationError(
            403,
            ERROR_CODES.PERMISSION_DENIED,
            "You are assigned to event checkpoints, not the Main Gate."
          );
        }
        return SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED;
      }
    }
  }

  throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot operate this checkpoint.");
}

module.exports = { resolveScanAuthorization, SCAN_AUTHORIZATION_OUTCOMES };
