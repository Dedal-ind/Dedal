const { OAuth2Client } = require("google-auth-library");

const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * One client, reused. It caches Google's public signing keys (the JWKS behind
 * verifyIdToken) across calls, so a fresh client per request would refetch them
 * every time. It is created lazily and only when a Client ID exists, so an
 * install without Google configured never constructs it.
 */
let cachedClient = null;

function getClient() {
  if (!applicationConfig.googleClientId) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = new OAuth2Client(applicationConfig.googleClientId);
  }
  return cachedClient;
}

function isGoogleSignInConfigured() {
  return Boolean(applicationConfig.googleClientId);
}

/*
 * Verify a Google ID token and return the identity we trust from it.
 *
 * verifyIdToken does the security-critical work: it checks the RS256 signature
 * against Google's current public keys, that the issuer is Google, that the
 * token has not expired, and — because we pass `audience` — that the token was
 * minted for *our* Client ID and not some other app's. A token that fails any of
 * these throws, and we translate every failure into one opaque GOOGLE_TOKEN_INVALID
 * so a caller cannot probe which check failed.
 *
 * email_verified is enforced on top: Google can issue a token for an address it
 * has not confirmed the holder owns (rare, but possible with some linked
 * accounts), and we treat email ownership as proven only when Google says so —
 * the same bar the OTP path clears by definition.
 */
async function verifyGoogleIdToken(idToken) {
  const client = getClient();
  if (!client) {
    throw new ApplicationError(
      503,
      ERROR_CODES.GOOGLE_SIGN_IN_NOT_CONFIGURED,
      "Google sign-in is not enabled on this server."
    );
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: applicationConfig.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApplicationError(401, ERROR_CODES.GOOGLE_TOKEN_INVALID, "Could not verify this Google sign-in.");
  }

  // Defensive: a verified token with no email claim at all is distinct from an
  // unverified one — the caller cannot establish a session without an address.
  if (!payload?.email) {
    throw new ApplicationError(401, ERROR_CODES.GOOGLE_EMAIL_MISSING, "This Google account did not share an email address.");
  }
  if (payload.email_verified !== true) {
    throw new ApplicationError(401, ERROR_CODES.GOOGLE_TOKEN_INVALID, "This Google account's email is not verified.");
  }

  return {
    emailAddress: payload.email.trim().toLowerCase(),
    fullName: typeof payload.name === "string" ? payload.name.trim() : "",
    googleSubject: payload.sub,
    /*
     * Optional by design: plenty of Google accounts have no photo, and the claim
     * is simply absent then. Normalised to null so callers have one empty value
     * to test rather than distinguishing undefined from "".
     */
    profilePictureUrl:
      typeof payload.picture === "string" && payload.picture.trim() ? payload.picture.trim() : null,
  };
}

module.exports = { verifyGoogleIdToken, isGoogleSignInConfigured };
