const crypto = require("crypto");
const { VERIFICATION_CODE_LENGTH } = require("../constants/certificate-constants");

/*
 * A certificate's public verification code: 16 characters a recruiter might type
 * off a printed page, so confusable glyphs are excluded (no 0/O, no 1/I/L).
 * crypto.randomBytes rather than Math.random, so one code cannot be guessed from
 * another. Uniqueness is enforced by the unique index; the insert retries on the
 * rare collision, exactly as the invite-code path does.
 */
const UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateVerificationCode() {
  const randomBytes = crypto.randomBytes(VERIFICATION_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < VERIFICATION_CODE_LENGTH; index += 1) {
    code += UNAMBIGUOUS_ALPHABET[randomBytes[index] % UNAMBIGUOUS_ALPHABET.length];
  }
  return code;
}

module.exports = { generateVerificationCode, UNAMBIGUOUS_ALPHABET };
