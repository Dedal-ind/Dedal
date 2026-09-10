const crypto = require("crypto");

/*
 * 24 random bytes encode to exactly 32 base64url characters with no padding
 * (24 is divisible by 3), so the token is a fixed length and URL-safe. base64url
 * uses "-" and "_" in place of "+" and "/", so the token needs no escaping in a
 * URL or a QR payload. randomBytes, not Math.random, so a token is unguessable.
 */
function generateQrToken() {
  return crypto.randomBytes(24).toString("base64url");
}

module.exports = { generateQrToken };
