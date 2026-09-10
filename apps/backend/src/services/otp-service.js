const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const { OtpCodeModel } = require("../models/otp-code-model");
const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUTHENTICATION_CONSTANTS } = require("../constants/authentication-constants");
const {
  MAXIMUM_ATTEMPT_COUNT,
  enforceResendCooldown,
  enforceRollingAttemptLimit,
  enforcePerIpSendLimit,
  enforcePerAddressSendLimit,
  registerFailedAttempt,
  throwAttemptsExceededError,
} = require("./otp-attempt-helpers");

/*
 * randomInt draws uniformly over the range. Deriving a code from
 * randomBytes % 1_000_000 would bias the low codes, because 2^32 is not a
 * multiple of a million.
 */
function generateOtpCode() {
  const upperBound = 10 ** AUTHENTICATION_CONSTANTS.OTP_CODE_LENGTH;
  const randomNumber = crypto.randomInt(0, upperBound);
  return String(randomNumber).padStart(AUTHENTICATION_CONSTANTS.OTP_CODE_LENGTH, "0");
}

function throwInvalidOtpError() {
  throw new ApplicationError(400, ERROR_CODES.OTP_INVALID, "The code is incorrect or has already been used.");
}

/*
 * The master code is accepted only when the running environment is development.
 * applicationConfig.isDevelopment is derived once, at boot, from
 * APPLICATION_ENVIRONMENT — there is no runtime switch and no env var of its own.
 */
function isDevelopmentMasterCode(submittedCode) {
  return (
    applicationConfig.isDevelopment &&
    submittedCode === AUTHENTICATION_CONSTANTS.DEVELOPMENT_MASTER_OTP_CODE
  );
}

async function createOtpCode(emailAddress, ipAddress) {
  // Ahead of the address cooldown, so a hammering IP is stopped before it even
  // reaches the address-side logic. The address-side ceiling runs next: unlike
  // the IP bucket it is unaffected by shared NAT, so it holds even when a whole
  // campus shares one public address.
  await enforcePerIpSendLimit(ipAddress);
  await enforcePerAddressSendLimit(emailAddress);
  await enforceResendCooldown(emailAddress);

  /*
   * Retire every outstanding code for this address before issuing a new one.
   * That makes consumeOtpCode's "newest row" lookup correct by construction:
   * an older code can never be simultaneously unconsumed and unreachable.
   */
  await OtpCodeModel.updateMany(
    { emailAddress, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const otpCode = generateOtpCode();
  const codeHash = await bcrypt.hash(otpCode, AUTHENTICATION_CONSTANTS.OTP_HASH_SALT_ROUNDS);
  const expiresAt = new Date(
    Date.now() + AUTHENTICATION_CONSTANTS.OTP_EXPIRY_MINUTES * 60 * 1000
  );

  // `|| undefined` lets the model's unknown-IP default fire for a context-less caller.
  await OtpCodeModel.create({ emailAddress, codeHash, expiresAt, ipAddress: ipAddress || undefined });
  return otpCode;
}

async function consumeOtpCode(emailAddress, submittedCode) {
  const otpCodeDocument = await OtpCodeModel.findOne({ emailAddress })
    .sort({ createdAt: -1 })
    .select("+codeHash");

  // No code ever requested, or already consumed: indistinguishable to the client.
  if (!otpCodeDocument || otpCodeDocument.consumedAt) {
    throwInvalidOtpError();
  }
  if (otpCodeDocument.expiresAt.getTime() <= Date.now()) {
    throw new ApplicationError(400, ERROR_CODES.OTP_EXPIRED, "This code has expired. Request a new one.");
  }
  if (otpCodeDocument.attemptCount >= MAXIMUM_ATTEMPT_COUNT) {
    throwAttemptsExceededError();
  }

  /*
   * Checked before the comparison, so an address that has spent its rolling
   * budget is locked out rather than allowed one more guess per fresh code.
   */
  await enforceRollingAttemptLimit(emailAddress);

  const isCodeMatching =
    isDevelopmentMasterCode(submittedCode) ||
    (await bcrypt.compare(submittedCode, otpCodeDocument.codeHash));

  if (!isCodeMatching) {
    await registerFailedAttempt(otpCodeDocument._id);
    throwInvalidOtpError();
  }

  /*
   * consumedAt: null in the filter makes consumption single-winner. If a
   * concurrent request consumed the row first, this returns null and the loser
   * is told the code is invalid rather than that it was already used.
   */
  const consumedOtpCode = await OtpCodeModel.findOneAndUpdate(
    { _id: otpCodeDocument._id, consumedAt: null },
    { consumedAt: new Date() },
    { new: true }
  );

  if (!consumedOtpCode) {
    throwInvalidOtpError();
  }
}

module.exports = { createOtpCode, consumeOtpCode };
