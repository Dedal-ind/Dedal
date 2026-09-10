const crypto = require("crypto");

const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_SLUG_MAXIMUM_ATTEMPTS } = require("../constants/event-constants");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const RANDOM_SUFFIX_LENGTH = 8;

/*
 * A duplicate-key error is only ours to retry if it came from the slug index.
 * Any other unique index colliding is a real fault and must propagate.
 *
 * The index is compound on (festId, eventSlug), so two fests may each hold an
 * event called "robowars"; only a collision inside one fest is a collision.
 */
function isEventSlugDuplicateError(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("eventSlug")
  );
}

/*
 * Records the collision it swallowed. Every attempt throws its own E11000, and
 * without keeping the last one the final failure would report that the slug was
 * contested but not what the database actually said.
 */
async function tryInsert(eventAttributes, candidateSlug, collisionReport) {
  try {
    return await EventModel.create({ ...eventAttributes, eventSlug: candidateSlug });
  } catch (error) {
    if (!isEventSlugDuplicateError(error)) {
      throw error;
    }
    collisionReport.lastErrorMessage = error.message;
    return null;
  }
}

/*
 * Attempt 1 uses the base slug; attempt N appends "-N". The insert is the
 * uniqueness check — checking first and then inserting would race two admins
 * naming an event identically at the same moment. After the numbered attempts
 * are exhausted, one random suffix is near-certain to land.
 */
async function insertEventWithUniqueSlug(eventAttributes, baseSlug) {
  const collisionReport = { lastErrorMessage: null };
  let slugCollisionCount = 0;

  for (let attempt = 1; attempt <= EVENT_SLUG_MAXIMUM_ATTEMPTS; attempt += 1) {
    const candidateSlug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const event = await tryInsert(eventAttributes, candidateSlug, collisionReport);
    if (event) {
      return event;
    }
    slugCollisionCount += 1;
  }

  /*
   * Observability, not debugging: exhausting every numbered slug means either a
   * pathological fest or a broken index, and neither is visible any other way.
   * Unconditional by design — production is exactly where we need to hear it.
   */
  console.warn(
    `slug collision fallback used for festId=${eventAttributes.festId}, ` +
      `baseSlug=${baseSlug}, retries=${slugCollisionCount}`
  );

  const randomSuffix = crypto.randomUUID().slice(0, RANDOM_SUFFIX_LENGTH);
  const event = await tryInsert(eventAttributes, `${baseSlug}-${randomSuffix}`, collisionReport);
  if (event) {
    return event;
  }
  slugCollisionCount += 1;

  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not allocate a unique event slug.",
    {
      contestedSlug: baseSlug,
      attemptCount: slugCollisionCount,
      originalErrorMessage: collisionReport.lastErrorMessage,
    }
  );
}

module.exports = { insertEventWithUniqueSlug };
