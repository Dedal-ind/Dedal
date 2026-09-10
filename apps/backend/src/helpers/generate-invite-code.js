const crypto = require("crypto");
const { INVITE_CODE_LENGTH } = require("../constants/registration-constants");

/*
 * Confusable characters are excluded so a code read aloud or off a screen is
 * unambiguous: no 0/O, no 1/I/L. crypto.randomBytes rather than Math.random, so
 * a code is not predictable from an earlier one.
 */
const UNAMBIGUOUS_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateInviteCode() {
  const randomBytes = crypto.randomBytes(INVITE_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += UNAMBIGUOUS_ALPHABET[randomBytes[index] % UNAMBIGUOUS_ALPHABET.length];
  }
  return code;
}

module.exports = { generateInviteCode };
