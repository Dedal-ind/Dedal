const { TeamModel } = require("../models/team-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateInviteCode } = require("./generate-invite-code");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const INVITE_CODE_MAXIMUM_ATTEMPTS = 20;

/*
 * A duplicate-key error is only ours to retry if it came from the inviteCode
 * index. Any other unique index colliding is a real fault and must propagate.
 */
function isInviteCodeDuplicateError(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("inviteCode")
  );
}

/*
 * Each attempt mints a fresh code, so a collision retries rather than fails. The
 * insert is the uniqueness check: checking first would race two teams minting the
 * same code at the same moment. At 31^8 the loop effectively never exhausts.
 */
async function insertTeamWithUniqueInviteCode(teamAttributes) {
  let lastErrorMessage = null;

  for (let attempt = 1; attempt <= INVITE_CODE_MAXIMUM_ATTEMPTS; attempt += 1) {
    try {
      return await TeamModel.create({ ...teamAttributes, inviteCode: generateInviteCode() });
    } catch (error) {
      if (!isInviteCodeDuplicateError(error)) {
        throw error;
      }
      lastErrorMessage = error.message;
    }
  }

  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not allocate a unique team invite code.",
    { attemptCount: INVITE_CODE_MAXIMUM_ATTEMPTS, originalErrorMessage: lastErrorMessage }
  );
}

module.exports = { insertTeamWithUniqueInviteCode };
