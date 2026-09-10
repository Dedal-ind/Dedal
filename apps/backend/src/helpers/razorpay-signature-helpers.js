const crypto = require("node:crypto");

/*
 * The two Razorpay signature checks, both plain HMAC-SHA256 (no network, so they
 * run for real in tests). The checkout callback signs "orderId|paymentId" with the
 * key secret; the webhook signs the raw request body with the webhook secret.
 * Extracted here so a test can compute the same HMAC — or override this module.
 */
function computeHmacHex(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Constant-time compare on equal-length hex strings; unequal lengths are a mismatch.
function safeEqualHex(expectedHex, actualHex) {
  if (typeof actualHex !== "string" || expectedHex.length !== actualHex.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(actualHex, "hex"));
}

function isValidPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature, keySecret }) {
  const expected = computeHmacHex(`${razorpayOrderId}|${razorpayPaymentId}`, keySecret);
  return safeEqualHex(expected, signature);
}

function isValidWebhookSignature({ rawBody, signature, webhookSecret }) {
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const expected = computeHmacHex(payload, webhookSecret);
  return safeEqualHex(expected, signature);
}

module.exports = { isValidPaymentSignature, isValidWebhookSignature, computeHmacHex };
