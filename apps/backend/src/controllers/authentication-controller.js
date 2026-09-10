const authenticationService = require("../services/authentication-service");
const {
  validateEmailAddress,
  validateOtpCode,
  validateGoogleIdToken,
} = require("../validators/authentication-validators");
const { extractRequestContext } = require("../helpers/request-context");
const { applicationConfig } = require("../config/application-config");

async function handleRequestOtp(request, response) {
  const emailAddress = validateEmailAddress(request.body.emailAddress);
  const responseData = await authenticationService.requestOtp(
    emailAddress,
    extractRequestContext(request)
  );

  response.status(200).json({ data: responseData });
}

async function handleVerifyOtp(request, response) {
  const emailAddress = validateEmailAddress(request.body.emailAddress);
  const code = validateOtpCode(request.body.code);
  const responseData = await authenticationService.verifyOtp(
    emailAddress,
    code,
    extractRequestContext(request)
  );

  response.status(200).json({ data: responseData });
}

async function handleGoogleSignIn(request, response) {
  // The client posts the Google ID token as `googleIdToken`.
  const idToken = validateGoogleIdToken(request.body.googleIdToken);
  const responseData = await authenticationService.signInWithGoogle(
    idToken,
    extractRequestContext(request)
  );

  response.status(200).json({ data: responseData });
}

/*
 * The one source of truth for the browser's Google client id — served from the
 * SAME config value the backend verifies token audiences against, so the two can
 * never diverge (the frontend/backend env mismatch this replaces was silent and
 * indistinguishable from other Google failures).
 *
 * Returning the client id is safe by design: an OAuth client ID is a public
 * identifier (Google documents it as the app's public username), it is already
 * visible in the page source of any GSI integration, and the real control is the
 * Authorized JavaScript origins allowlist in the Google Cloud Console. The
 * CLIENT SECRET is what must never leave the server, and nothing here reads it.
 * null (not an error) when unset: Google sign-in is simply off, OTP unaffected.
 */
async function handleGoogleConfig(request, response) {
  response.status(200).json({ data: { clientId: applicationConfig.googleClientId } });
}

module.exports = { handleRequestOtp, handleVerifyOtp, handleGoogleSignIn, handleGoogleConfig };
