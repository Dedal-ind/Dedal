const crypto = require("crypto");

/*
 * A 6-digit numeric string for the pass's manual backup code. randomInt draws
 * from [100000, 999999] inclusive of the lower bound and exclusive of the upper,
 * so the value is always six digits — no leading zero can arise — and is drawn
 * from the CSPRNG rather than Math.random, so the code is not guessable from a
 * neighbour's.
 */
function generateBackupCode() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = { generateBackupCode };
