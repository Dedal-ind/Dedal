const validator = require("validator");

const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUTHENTICATION_CONSTANTS } = require("../constants/authentication-constants");

function throwValidationError(message, details) {
  throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
}

/*
 * Returns the normalised address rather than mutating the request body, so the
 * lowercase form used for the unique index is the same one every caller sees.
 */
function validateEmailAddress(emailAddress) {
  if (typeof emailAddress !== "string" || emailAddress.trim().length === 0) {
    throwValidationError("Email address is required.", { field: "emailAddress" });
  }

  const normalisedEmailAddress = emailAddress.trim().toLowerCase();

  if (!validator.isEmail(normalisedEmailAddress)) {
    throwValidationError("Email address is not valid.", { field: "emailAddress" });
  }

  return normalisedEmailAddress;
}

function validateOtpCode(code) {
  const expectedLength = AUTHENTICATION_CONSTANTS.OTP_CODE_LENGTH;

  if (typeof code !== "string" || code.trim().length === 0) {
    throwValidationError("Code is required.", { field: "code" });
  }

  const normalisedCode = code.trim();

  if (!validator.isNumeric(normalisedCode, { no_symbols: true })) {
    throwValidationError("Code must contain digits only.", { field: "code" });
  }
  if (normalisedCode.length !== expectedLength) {
    throwValidationError(`Code must be ${expectedLength} digits.`, { field: "code" });
  }

  return normalisedCode;
}

/*
 * The Google ID token is an opaque credential we forward to Google's verifier —
 * we do not parse it here. The only thing worth checking before that round-trip
 * is that a non-empty string arrived, so a blank body fails fast as a 400 rather
 * than as an obscure verification error. An upper bound guards against a caller
 * posting an unbounded blob; real Google ID tokens are well under 4KB.
 */
const MAXIMUM_ID_TOKEN_LENGTH = 8192;

function validateGoogleIdToken(idToken) {
  if (typeof idToken !== "string" || idToken.trim().length === 0) {
    throwValidationError("Google credential is required.", { field: "googleIdToken" });
  }
  if (idToken.length > MAXIMUM_ID_TOKEN_LENGTH) {
    throwValidationError("Google credential is malformed.", { field: "googleIdToken" });
  }
  return idToken.trim();
}

module.exports = { validateEmailAddress, validateOtpCode, validateGoogleIdToken };
