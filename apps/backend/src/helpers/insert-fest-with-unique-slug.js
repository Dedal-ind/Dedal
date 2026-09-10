const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_SLUG_MAXIMUM_ATTEMPTS } = require("../constants/fest-constants");

const DUPLICATE_KEY_ERROR_CODE = 11000;

/*
 * A duplicate-key error is only ours to retry if it came from the slug index.
 * Any other unique index colliding is a real fault and must propagate.
 */
function isFestSlugDuplicateError(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("festSlug")
  );
}

/*
 * Attempt 1 uses the base slug; attempt N appends "-N". The insert is the
 * uniqueness check — checking first and then inserting would race two admins
 * naming a fest identically at the same moment.
 */
async function insertFestWithUniqueSlug(festAttributes, baseSlug) {
  // Kept so the final failure can report what the database actually said.
  let lastErrorMessage = null;

  for (let attempt = 1; attempt <= FEST_SLUG_MAXIMUM_ATTEMPTS; attempt += 1) {
    const candidateSlug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;

    try {
      return await FestModel.create({ ...festAttributes, festSlug: candidateSlug });
    } catch (error) {
      if (!isFestSlugDuplicateError(error)) {
        throw error;
      }
      lastErrorMessage = error.message;
    }
  }

  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not allocate a unique fest slug.",
    {
      contestedSlug: baseSlug,
      attemptCount: FEST_SLUG_MAXIMUM_ATTEMPTS,
      originalErrorMessage: lastErrorMessage,
    }
  );
}

module.exports = { insertFestWithUniqueSlug };
