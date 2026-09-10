const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");

const CONFLICT_MESSAGE =
  "This match was updated by someone else while you were editing. Refresh to see the latest state before submitting again.";

/*
 * A version arrives over JSON, so it may be a number, a numeric string, or
 * absent. Anything that is not a whole number is treated as absent rather than
 * coerced: a client sending "abc" has no idea what it last read, which is
 * exactly the state the missing-version rule is written for.
 */
function parseExpectedVersion(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/*
 * Refuses a write whose author was looking at a stale copy of the match.
 *
 * A missing expectedVersion is tolerated only while the match has never been
 * written (stored version 0). That lets a client built before this guard existed
 * still enter a first result, but forces it to send a version — and therefore to
 * have re-read the match — for every write after that. The moment a match has
 * any history, an unversioned write is exactly the silent overwrite this guard
 * exists to stop.
 *
 * buildConflictDetails is a callback rather than a value because it costs a
 * populated re-read, and the overwhelmingly common case is no conflict at all.
 */
async function assertMatchVersionOrConflict(matchDocument, expectedVersion, buildConflictDetails) {
  const storedVersion = matchDocument.version || 0;
  const parsedVersion = parseExpectedVersion(expectedVersion);

  if (parsedVersion === null && storedVersion === 0) {
    return;
  }
  if (parsedVersion === storedVersion) {
    return;
  }

  throw new ApplicationError(409, ERROR_CODES.MATCH_CONCURRENT_UPDATE, CONFLICT_MESSAGE, {
    currentMatch: await buildConflictDetails(),
  });
}

/*
 * The other half of the contract: every persisted change moves the version on by
 * one and records its author. Callers apply their mutation and then call this
 * immediately before save, so there is one place to look for "did this write
 * count as a version bump" — and no way to mutate a match without one.
 */
function stampMatchWrite(matchDocument, actorUserId) {
  matchDocument.version = (matchDocument.version || 0) + 1;
  matchDocument.lastUpdatedByUserId = actorUserId || null;
  return matchDocument;
}

module.exports = { assertMatchVersionOrConflict, stampMatchWrite };
