const { CertificateModel } = require("../models/certificate-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateVerificationCode } = require("./generate-verification-code");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const VERIFICATION_CODE_MAXIMUM_ATTEMPTS = 20;

function isVerificationCodeDuplicate(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("verificationCode")
  );
}

function isCertificateAlreadyExists(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("userId")
  );
}

/*
 * Inserts one certificate, minting a fresh verification code on each attempt so a
 * code collision retries. A duplicate on the (user, fest, event) index is not an
 * error but the idempotency signal: that person already has this certificate, so
 * the caller counts it as skipped (returns null).
 */
async function insertCertificate(candidate) {
  let lastErrorMessage = null;
  for (let attempt = 1; attempt <= VERIFICATION_CODE_MAXIMUM_ATTEMPTS; attempt += 1) {
    try {
      return await CertificateModel.create({
        ...candidate,
        verificationCode: generateVerificationCode(),
      });
    } catch (error) {
      if (isCertificateAlreadyExists(error)) {
        return null;
      }
      if (!isVerificationCodeDuplicate(error)) {
        throw error;
      }
      lastErrorMessage = error.message;
    }
  }
  throw new ApplicationError(
    500,
    ERROR_CODES.CERTIFICATE_CODE_COLLISION,
    "Could not allocate a unique certificate verification code.",
    { originalErrorMessage: lastErrorMessage }
  );
}

module.exports = {
  DUPLICATE_KEY_ERROR_CODE,
  VERIFICATION_CODE_MAXIMUM_ATTEMPTS,
  isVerificationCodeDuplicate,
  isCertificateAlreadyExists,
  insertCertificate,
};
