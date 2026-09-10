const { verifyAuthenticationToken } = require("./token-helpers");

/*
 * "Who is this, if anyone?" — for a route that must serve signed-out callers but
 * would like to attribute the request when it can.
 *
 * Deliberately NOT a middleware. authenticationMiddleware's job is to REFUSE an
 * absent or bad token; this one's job is to shrug at it. Wiring an "optional"
 * mode into that middleware would put a bypass branch inside the gate every
 * authenticated route depends on, which is the last place to add a branch.
 *
 * Never throws: a malformed, expired or forged token resolves to null, exactly
 * as no token at all does. The caller must treat the result as a hint, never as
 * an authorization decision.
 */
function readOptionalAuthenticatedUserId(request) {
  try {
    const authorizationHeader = request.headers?.authorization;
    if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
      return null;
    }
    const authenticationToken = authorizationHeader.slice("Bearer ".length).trim();
    if (!authenticationToken) {
      return null;
    }
    const payload = verifyAuthenticationToken(authenticationToken);
    return payload?.id ?? null;
  } catch {
    return null;
  }
}

module.exports = { readOptionalAuthenticatedUserId };
