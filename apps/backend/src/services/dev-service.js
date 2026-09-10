/*
 * Development-only helpers behind /api/v1/dev. Their entire purpose is to let a
 * developer jump between seeded identities without running the OTP flow for each,
 * so they are HARD-GATED to APPLICATION_ENVIRONMENT=development: outside it every
 * entry point throws a 404, indistinguishable from the route not existing, so a
 * production deploy never exposes a passwordless login.
 */
const { applicationConfig } = require("../config/application-config");
const { UserModel } = require("../models/user-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { createAuthenticationToken } = require("../helpers/token-helpers");

// The single gate. Called at the top of every dev entry point.
function assertDevelopment() {
  if (!applicationConfig.isDevelopment) {
    throw new ApplicationError(404, ERROR_CODES.ROUTE_NOT_FOUND, "Not found.");
  }
}

// Coarsest-first, so a user with several assignments is labelled by their most
// privileged one — which is what a tester picking an identity actually cares about.
const ROLE_RANK = [
  STAFF_ROLES.PLATFORM_ADMIN,
  STAFF_ROLES.ADMINISTRATOR,
  STAFF_ROLES.COORDINATOR,
  STAFF_ROLES.VOLUNTEER,
];

/*
 * Every user, tagged with their highest active staff role (or "participant"), for
 * the dev switcher's picker. One query for users and one for assignments — no
 * per-user round trip.
 */
async function listSwitchableUsers() {
  assertDevelopment();

  const users = await UserModel.find({})
    .select("emailAddress fullName")
    .sort({ fullName: 1 })
    .lean();

  const assignments = await StaffAssignmentModel.find({
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId role")
    .lean();

  const rolesByUserId = new Map();
  for (const assignment of assignments) {
    const key = String(assignment.userId);
    const existing = rolesByUserId.get(key);
    const better =
      existing === undefined || ROLE_RANK.indexOf(assignment.role) < ROLE_RANK.indexOf(existing);
    if (better) {
      rolesByUserId.set(key, assignment.role);
    }
  }

  return users.map((user) => ({
    id: String(user._id),
    emailAddress: user.emailAddress,
    fullName: user.fullName || null,
    role: rolesByUserId.get(String(user._id)) || "participant",
  }));
}

/*
 * Mints a session token for a seeded user by email, with no OTP — the whole point
 * of the switcher. The token and user shape match verifyOtp exactly, so the client
 * stores them through the same signIn path.
 */
async function loginAs(emailAddress) {
  assertDevelopment();

  const normalisedEmail = String(emailAddress || "").trim().toLowerCase();
  if (!normalisedEmail) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "emailAddress is required.");
  }

  const user = await UserModel.findOne({ emailAddress: normalisedEmail });
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "No user with that email.");
  }

  return {
    authenticationToken: createAuthenticationToken(user),
    user: user.toJSON(),
    isNewUser: false,
  };
}

module.exports = { listSwitchableUsers, loginAs };
