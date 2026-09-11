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

/*
 * DOES THIS USER HOLD ADMINISTRATOR AUTHORITY OVER THIS COLLEGE. The single
 * answer to that question, and the one every gate must ask.
 *
 * Authority is NOT the same as holding an assignment row, and conflating the two
 * is what broke the platform owner. `findActiveAdministratorAssignment` above is
 * a row lookup scoped to one college; a platform admin's assignment carries no
 * college (see platform-admin-helpers: it is "not of anything, it is over
 * everything"), so that query returns null for them against every college on the
 * system. Nine call sites asked the row-lookup question while meaning the
 * authority one. Two of them — assertAdministrator and the administrator
 * middleware — had each grown their own private god-mode branch; the other seven
 * had not, so the platform owner was refused by the coordinator-or-admin gate,
 * the scan gate, the bracket gate, the feedback gate, participant search, the
 * staff directory and the cancellation-policy resolver.
 *
 * Returning the marker rather than a boolean keeps the one caller that needs an
 * assignment id (the administrator middleware) able to tell the two cases apart.
 * Returns the real row, { platformAdmin: true }, or null.
 */
async function findAdministratorAuthority(userId, collegeId) {
  const assignment = await findActiveAdministratorAssignment(userId, collegeId);
  if (assignment) {
    return assignment;
  }
  if (await isPlatformAdmin(userId)) {
    return { platformAdmin: true };
  }
  return null;
}

/* The boolean form, for the gates that only need yes/no. */
async function hasAdministratorAuthority(userId, collegeId) {
  return Boolean(await findAdministratorAuthority(userId, collegeId));
}

async function assertAdministrator(userId, collegeId) {
  const authority = await findAdministratorAuthority(userId, collegeId);
  if (authority) {
    return authority;
  }

  throw new ApplicationError(
    403,
    ERROR_CODES.PERMISSION_DENIED,
    "You are not an administrator of this college."
  );
}

module.exports = {
  findActiveAdministratorAssignment,
  findAdministratorAuthority,
  hasAdministratorAuthority,
  findActiveAdministratorUserIds,
  assertAdministrator,
};
