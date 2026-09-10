const { PassModel } = require("../models/pass-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateQrToken } = require("./generate-qr-token");
const { generateBackupCode } = require("./generate-backup-code");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const SECRET_MAXIMUM_ATTEMPTS = 20;

/*
 * A pass carries two independent secrets — the qrToken and the backupCode — each
 * under its own unique index. Returns which secret collided so only the offending
 * one is reminted, rather than throwing both away and biasing the retry.
 */
function contestedSecretField(error) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
    return null;
  }
  const keys = Object.keys(error.keyPattern || {});
  if (keys.includes("qrToken")) return "qrToken";
  if (keys.includes("backupCode")) return "backupCode";
  return null;
}

/*
 * Mints both secrets and inserts; on a duplicate-key collision it regenerates
 * only the field that collided and retries. After SECRET_MAXIMUM_ATTEMPTS it
 * gives up with the contested field named, rather than looping forever against a
 * space that has somehow filled.
 */
async function insertPassWithUniqueSecrets(userId, festId) {
  const candidate = { userId, festId, qrToken: generateQrToken(), backupCode: generateBackupCode() };

  for (let attempt = 1; attempt <= SECRET_MAXIMUM_ATTEMPTS; attempt += 1) {
    try {
      return await PassModel.create(candidate);
    } catch (error) {
      const contested = contestedSecretField(error);
      if (!contested) throw error;
      candidate[contested] = contested === "qrToken" ? generateQrToken() : generateBackupCode();
    }
  }

  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not allocate unique pass secrets.",
    { contested_field: "qrToken_or_backupCode" }
  );
}

module.exports = { insertPassWithUniqueSecrets };
