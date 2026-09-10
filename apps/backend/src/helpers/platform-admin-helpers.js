const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

/*
 * The product owner: a single platform-scoped role above every college. Its
 * assignment carries no college and no fest (both null) — it is not "of" anything,
 * it is over everything. Every college/fest admin check treats an active platform
 * admin as authorised (god mode), so this one predicate is the whole superadmin.
 */
async function isPlatformAdmin(userId) {
  const assignment = await StaffAssignmentModel.findOne({
    userId,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();
  return Boolean(assignment);
}

async function assertPlatformAdmin(userId) {
  if (!(await isPlatformAdmin(userId))) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "This action is restricted to the platform owner."
    );
  }
}

module.exports = { isPlatformAdmin, assertPlatformAdmin };
