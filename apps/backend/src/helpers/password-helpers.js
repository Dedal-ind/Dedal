const bcrypt = require("bcryptjs");

const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * Password hashing and strength, kept apart from the OTP path that shares the
 * same bcrypt dependency.
 *
 * COST FACTOR 12: bcrypt's work factor is the whole defence for a stolen hash.
 * 12 is roughly 250ms per hash on current server hardware — slow enough that an
 * offline attacker's throughput collapses, fast enough that a sign-in does not
 * feel stalled. It is deliberately higher than the OTP hash's factor: an OTP
 * lives for minutes and is single-use, a password lives for months.
 */
const PASSWORD_HASH_COST_FACTOR = 12;

/*
 * NIST SP 800-63B (2024 revision) guidance: length is what matters, and forced
 * composition rules ("must contain a special character") measurably WORSEN
 * outcomes — users satisfy them with predictable substitutions and then reuse
 * the result. So: 10 characters minimum, at least one letter and one digit to
 * refuse an all-numeric PIN or an all-alphabetic word, and nothing more.
 */
const PASSWORD_MINIMUM_LENGTH = 10;

/*
 * A pre-computed hash of a value nobody can supply, used to burn the same
 * ~250ms on the "no such user" branch as on a real verification. Without it the
 * sign-in endpoint answers instantly for an unknown address and slowly for a
 * known one, which is an account-enumeration oracle no amount of identical
 * error messaging can close (OWASP A07).
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dedal-timing-equaliser", PASSWORD_HASH_COST_FACTOR);

function validatePasswordStrength(candidatePassword) {
  const details = {};
  if (typeof candidatePassword !== "string" || candidatePassword.length === 0) {
    details.newPassword = "is required";
  } else {
    if (candidatePassword.length < PASSWORD_MINIMUM_LENGTH) {
      details.newPassword = `must be at least ${PASSWORD_MINIMUM_LENGTH} characters`;
    } else if (!/[A-Za-z]/.test(candidatePassword) || !/\d/.test(candidatePassword)) {
      details.newPassword = "must contain at least one letter and one digit";
    }
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "That password does not meet the minimum requirements.",
      details
    );
  }
}

function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, PASSWORD_HASH_COST_FACTOR);
}

function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/* Burns the same work as a real comparison, then always fails. */
function burnPasswordComparison(plainPassword) {
  return bcrypt.compare(typeof plainPassword === "string" ? plainPassword : "", DUMMY_PASSWORD_HASH);
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnPasswordComparison,
  validatePasswordStrength,
  PASSWORD_HASH_COST_FACTOR,
  PASSWORD_MINIMUM_LENGTH,
};
