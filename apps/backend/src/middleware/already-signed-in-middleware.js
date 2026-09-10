const { verifyAuthenticationToken } = require("../helpers/token-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { extractBearerToken } = require("../helpers/extract-bearer-token-helper");

/*
 * Guards the login entry points (request-OTP, verify-OTP, Google) against a
 * caller who already holds a session. A signed-in user requesting a code for
 * an arbitrary address, then minting a session bound to it, is the attack this
 * refuses. Only a Bearer token that actually verifies counts: an absent,
 * malformed, or unverifiable token is the same as no token here, because this
 * is an unauthenticated endpoint and a bad credential simply proves nothing.
 * Nothing is attached to the request and nothing is read from the database.
 */
function alreadySignedInMiddleware(request, response, next) {
  const authenticationToken = extractBearerToken(request.headers.authorization);
  if (!authenticationToken) {
    return next();
  }

  try {
    verifyAuthenticationToken(authenticationToken);
  } catch (error) {
    return next();
  }

  return next(
    new ApplicationError(400, ERROR_CODES.USER_ALREADY_SIGNED_IN, "You are already signed in.")
  );
}

module.exports = { alreadySignedInMiddleware };
