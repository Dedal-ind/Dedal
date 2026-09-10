const { assertPlatformAdmin } = require("../helpers/platform-admin-helpers");

/*
 * Gates a route to the platform owner. Used for college onboarding/verification —
 * the actions that sit above any single college.
 */
async function requirePlatformAdminMiddleware(request, response, next) {
  try {
    await assertPlatformAdmin(request.authenticatedUser.userId);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requirePlatformAdminMiddleware };
