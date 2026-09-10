const { OtpCodeModel } = require("../models/otp-code-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUTHENTICATION_CONSTANTS } = require("../constants/authentication-constants");
const { UNKNOWN_IP_ADDRESS } = require("../constants/sign-in-constants");

const MAXIMUM_ATTEMPT_COUNT = AUTHENTICATION_CONSTANTS.OTP_MAXIMUM_VERIFY_ATTEMPTS;

const ROLLING_WINDOW_MINUTES = AUTHENTICATION_CONSTANTS.OTP_ROLLING_ATTEMPT_WINDOW_MINUTES;
const ROLLING_MAXIMUM_ATTEMPT_COUNT = AUTHENTICATION_CONSTANTS.OTP_ROLLING_MAXIMUM_ATTEMPTS;

const IP_ROLLING_WINDOW_MINUTES = AUTHENTICATION_CONSTANTS.OTP_IP_ROLLING_WINDOW_MINUTES;
const IP_ROLLING_MAXIMUM_SENDS = AUTHENTICATION_CONSTANTS.OTP_IP_ROLLING_MAXIMUM_SENDS;
const IP_BURST_WINDOW_SECONDS = AUTHENTICATION_CONSTANTS.OTP_IP_BURST_WINDOW_SECONDS;
const IP_BURST_MAXIMUM_SENDS = AUTHENTICATION_CONSTANTS.OTP_IP_BURST_MAXIMUM_SENDS;

const ADDRESS_SEND_WINDOW_MINUTES =
  AUTHENTICATION_CONSTANTS.OTP_ADDRESS_ROLLING_SEND_WINDOW_MINUTES;
const ADDRESS_MAXIMUM_SENDS = AUTHENTICATION_CONSTANTS.OTP_ADDRESS_ROLLING_MAXIMUM_SENDS;

function throwAttemptsExceededError() {
  throw new ApplicationError(
    400,
    ERROR_CODES.OTP_ATTEMPTS_EXCEEDED,
    "Too many incorrect attempts. Request a new code."
  );
}

/*
 * The per-code cap is reset by issuing a new code, so on its own it bounds
 * nothing: an attacker could request a code, spend five guesses, and repeat. The
 * budget therefore also has to be counted per address across a rolling window,
 * summed over every code that address holds in it.
 */
async function countRecentFailedAttempts(emailAddress) {
  const windowStart = new Date(Date.now() - ROLLING_WINDOW_MINUTES * 60 * 1000);

  const [totals] = await OtpCodeModel.aggregate([
    { $match: { emailAddress, createdAt: { $gte: windowStart } } },
    { $group: { _id: null, totalAttemptCount: { $sum: "$attemptCount" } } },
  ]);

  return totals ? totals.totalAttemptCount : 0;
}

/*
 * Deliberately carries no details. A retryAfterSeconds would publish the length
 * of the rolling window, and an attempts-remaining count would tell a guesser
 * exactly how much budget is left before the address locks.
 */
async function enforceRollingAttemptLimit(emailAddress) {
  if ((await countRecentFailedAttempts(emailAddress)) >= ROLLING_MAXIMUM_ATTEMPT_COUNT) {
    throw new ApplicationError(
      429,
      ERROR_CODES.OTP_ATTEMPT_LIMIT_EXCEEDED,
      "Too many incorrect attempts from this address. Try again later."
    );
  }
}

async function countRecentSendsFromIp(ipAddress, windowStart) {
  const [totals] = await OtpCodeModel.aggregate([
    { $match: { ipAddress, createdAt: { $gte: windowStart } } },
    { $group: { _id: null, sendCount: { $sum: 1 } } },
  ]);

  return totals ? totals.sendCount : 0;
}

/*
 * Per-IP send throttle. One IP hitting many distinct addresses is invisible to
 * every per-address control — each address is only touched once — yet it spams
 * inboxes, drains SMTP quota, and burns sender reputation. Reads the OTP
 * collection as its own rolling-window store, exactly as the per-address limit
 * does. Two windows: an hourly ceiling and a short burst ceiling.
 *
 * The unknown-IP bucket is never throttled. It is a test-harness or
 * misconfigured-proxy path, and refusing everyone who lands in it at once would
 * be worse than the abuse the limit exists to stop.
 */
async function enforcePerIpSendLimit(ipAddress) {
  if (!ipAddress || ipAddress === UNKNOWN_IP_ADDRESS) {
    return;
  }

  const rollingWindowStart = new Date(Date.now() - IP_ROLLING_WINDOW_MINUTES * 60 * 1000);
  if ((await countRecentSendsFromIp(ipAddress, rollingWindowStart)) >= IP_ROLLING_MAXIMUM_SENDS) {
    // No retryAfterSeconds: it would publish the rolling window length.
    throw new ApplicationError(
      429,
      ERROR_CODES.OTP_SEND_RATE_LIMITED,
      "Too many codes requested from this network. Try again later."
    );
  }

  const burstWindowStart = new Date(Date.now() - IP_BURST_WINDOW_SECONDS * 1000);
  if ((await countRecentSendsFromIp(ipAddress, burstWindowStart)) >= IP_BURST_MAXIMUM_SENDS) {
    // Burst is short, so the window length is not a useful oracle to publish.
    throw new ApplicationError(
      429,
      ERROR_CODES.OTP_SEND_RATE_LIMITED,
      "Too many codes requested from this network. Please slow down.",
      { retryAfterSeconds: IP_BURST_WINDOW_SECONDS }
    );
  }
}

async function countRecentSendsForAddress(emailAddress, windowStart) {
  return OtpCodeModel.countDocuments({ emailAddress, createdAt: { $gte: windowStart } });
}

/*
 * Bounds how many codes one inbox can be sent per hour, independently of the
 * requester's IP. This is the control that survives shared NAT: a whole campus
 * behind one address cannot exhaust it for each other, but nobody can be mailed
 * sixty codes by walking the resend cooldown either.
 */
async function enforcePerAddressSendLimit(emailAddress) {
  const windowStart = new Date(Date.now() - ADDRESS_SEND_WINDOW_MINUTES * 60 * 1000);

  if ((await countRecentSendsForAddress(emailAddress, windowStart)) >= ADDRESS_MAXIMUM_SENDS) {
    // No retryAfterSeconds: it would publish the rolling window length.
    throw new ApplicationError(
      429,
      ERROR_CODES.OTP_SEND_RATE_LIMITED,
      "Too many codes requested for this address. Try again later."
    );
  }
}

async function enforceResendCooldown(emailAddress) {
  const mostRecentOtpCode = await OtpCodeModel.findOne({ emailAddress })
    .sort({ createdAt: -1 })
    .lean();

  if (!mostRecentOtpCode) {
    return;
  }

  const cooldownMilliseconds = AUTHENTICATION_CONSTANTS.OTP_RESEND_COOLDOWN_SECONDS * 1000;
  const elapsedMilliseconds = Date.now() - mostRecentOtpCode.createdAt.getTime();

  if (elapsedMilliseconds < cooldownMilliseconds) {
    const retryAfterSeconds = Math.ceil((cooldownMilliseconds - elapsedMilliseconds) / 1000);
    throw new ApplicationError(
      429,
      ERROR_CODES.OTP_SEND_RATE_LIMITED,
      "An OTP was already sent recently. Please wait before requesting another.",
      { retryAfterSeconds }
    );
  }
}

/*
 * The attemptCount guard lives in the query filter, not in JavaScript, so
 * concurrent wrong guesses cannot both read the same count and write the same
 * increment. A null result means the cap was already reached.
 */
async function registerFailedAttempt(otpCodeId) {
  const updatedOtpCode = await OtpCodeModel.findOneAndUpdate(
    { _id: otpCodeId, attemptCount: { $lt: MAXIMUM_ATTEMPT_COUNT } },
    { $inc: { attemptCount: 1 } },
    { new: true }
  );

  if (!updatedOtpCode) {
    throwAttemptsExceededError();
  }
}

module.exports = {
  MAXIMUM_ATTEMPT_COUNT,
  ROLLING_MAXIMUM_ATTEMPT_COUNT,
  enforceResendCooldown,
  enforceRollingAttemptLimit,
  enforcePerIpSendLimit,
  enforcePerAddressSendLimit,
  countRecentFailedAttempts,
  registerFailedAttempt,
  throwAttemptsExceededError,
};
