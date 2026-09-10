const { USER_AGENT_MAX_LENGTH } = require("../constants/sign-in-constants");

/*
 * The audit and sign-in trails want the caller's IP and user-agent, which live on
 * the request, not in any service argument. Controllers call this and pass the
 * result down as a context object, so a service stays testable without a request.
 */
function extractRequestContext(request) {
  const rawUserAgent = request?.headers?.["user-agent"];
  const userAgent =
    typeof rawUserAgent === "string" ? rawUserAgent.slice(0, USER_AGENT_MAX_LENGTH) : null;
  return { ipAddress: request?.ip || null, userAgent };
}

module.exports = { extractRequestContext };
