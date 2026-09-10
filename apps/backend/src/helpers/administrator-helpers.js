const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { isPlatformAdmin } = require("./platform-admin-helpers");

/*
 * The single source of truth for "is this user an administrator of this
 * college". Both the route middleware and the service layer call it, so an
 * endpoint mounted without the middleware still cannot bypass the check.
 */
async function findActiveAdministratorAssignment(userId, collegeId) {
  return StaffAssignmentModel.findOne({
    userId,
    collegeId,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
}

/*
 * The administrator ids among the given users, in one query rather than one per
 * member. Unscoped by college on purpose: an administrator anywhere may not take
 * a seat anywhere, so the caller does not have to know which college granted it.
 * An administrator assignment carries no validity window, so there is none to
 * check — the row's active status is the whole test.
 */
async function findActiveAdministratorUserIds(userIds) {
  const assignments = await StaffAssignmentModel.find({
    userId: { $in: userIds },
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId")
    .lean();

  return new Set(assignments.map((assignment) => String(assignment.userId)));
}

async function assertAdministrator(userId, collegeId) {
  const assignment = await findActiveAdministratorAssignment(userId, collegeId);
  if (assignment) {
    return assignment;
  }

  // God mode: the platform owner administers every college. Returns a marker rather
  // than a real assignment row, since there isn't one.
  if (await isPlatformAdmin(userId)) {
    return { platformAdmin: true };
  }

  throw new ApplicationError(
    403,
    ERROR_CODES.PERMISSION_DENIED,
    "You are not an administrator of this college."
  );
}

module.exports = {
  findActiveAdministratorAssignment,
  findActiveAdministratorUserIds,
  assertAdministrator,
};
