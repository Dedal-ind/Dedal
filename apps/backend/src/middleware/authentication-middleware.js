const jsonwebtoken = require("jsonwebtoken");

const { verifyAuthenticationToken } = require("../helpers/token-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { extractBearerToken } = require("../helpers/extract-bearer-token-helper");
const { UserModel } = require("../models/user-model");

/*
 * Verifies the token, then reloads the live user before calling next. The token
 * is no longer the whole assertion: a blocked account is a moderation decision
 * that must take effect immediately across every surface, and a 30-day JWT
 * minted before the block cannot be allowed to outlive it. The cost is one
 * indexed findById per authenticated request. The DB emailAddress — not the
 * token's copy — is attached, so a stale token still reads the current address.
 */
async function authenticationMiddleware(request, response, next) {
  const authenticationToken = extractBearerToken(request.headers.authorization);

  if (!authenticationToken) {
    return next(
      new ApplicationError(401, ERROR_CODES.AUTHENTICATION_TOKEN_MISSING, "Authentication token is missing.")
    );
  }

  let tokenPayload;
  try {
    tokenPayload = verifyAuthenticationToken(authenticationToken);
  } catch (error) {
    if (error instanceof jsonwebtoken.TokenExpiredError) {
      return next(
        new ApplicationError(401, ERROR_CODES.AUTHENTICATION_TOKEN_EXPIRED, "Authentication token has expired.")
      );
    }
    return next(
      new ApplicationError(401, ERROR_CODES.AUTHENTICATION_TOKEN_INVALID, "Authentication token is invalid.")
    );
  }

  try {
    const user = await UserModel.findById(tokenPayload.userId).select("emailAddress isBlocked").lean();

    // A still-valid token whose subject no longer exists is an invalid token.
    if (!user) {
      return next(new ApplicationError(401, ERROR_CODES.USER_NOT_FOUND, "User not found."));
    }
    // The token is valid but its holder is barred.
    if (user.isBlocked) {
      return next(new ApplicationError(403, ERROR_CODES.USER_BLOCKED, "This account is blocked."));
    }

    request.authenticatedUser = {
      userId: tokenPayload.userId,
      emailAddress: user.emailAddress,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authenticationMiddleware };
