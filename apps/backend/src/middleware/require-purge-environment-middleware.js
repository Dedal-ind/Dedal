/*
 * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
 *
 * The hard gate on the destructive test-only purge endpoint. It sits at the ROUTE
 * level, before any controller or service runs, so in production the request is
 * refused without a single database read — the handler is never reached and there
 * is no code path from a production request to a delete.
 *
 * Gated on APPLICATION_ENVIRONMENT rather than NODE_ENV or the hostname: the
 * config module already fails fast if it is unset, and a staging build served on
 * an unexpected domain must still behave as staging.
 */
const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

const PURGE_ALLOWED_ENVIRONMENTS = ["development", "staging", "test"];

function requirePurgeEnvironmentMiddleware(request, response, next) {
  if (!PURGE_ALLOWED_ENVIRONMENTS.includes(applicationConfig.applicationEnvironment)) {
    return next(
      new ApplicationError(
        403,
        ERROR_CODES.PURGE_NOT_ALLOWED_IN_ENVIRONMENT,
        "The fest purge test tool is disabled in this environment.",
        { environment: applicationConfig.applicationEnvironment }
      )
    );
  }
  return next();
}

module.exports = { requirePurgeEnvironmentMiddleware, PURGE_ALLOWED_ENVIRONMENTS };
