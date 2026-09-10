const { MatchModel } = require("../models/match-model");
const { MATCH_STATUSES } = require("../constants/match-constants");

/*
 * What counts as a human having recorded something on a match.
 *
 * Deliberately NOT `version > 0`, even though every write bumps the version.
 * Since 12.9 the system stamps versions itself: generating a bracket with byes
 * advances each bye's winner into the next round, which bumps that next match's
 * version to 1 before any person has touched the bracket. Treating version as
 * activity would refuse to regenerate a bracket nobody had opened. Nothing is
 * lost by leaving it out — every human write path (enterMatchResult,
 * setScoresheet) also sets one of the fields below, so a real result is always
 * caught by a durable signal rather than a counter.
 */
const ACTIVITY_CONDITIONS = [
  { participantAScore: { $ne: null } },
  { participantBScore: { $ne: null } },
  { winnerUserId: { $ne: null } },
  { winnerTeamId: { $ne: null } },
  { isFinalized: true },
  { scoresheetImageUrl: { $ne: null } },
];

/*
 * Byes are excluded. A bye is finalised with a winner at generation time by the
 * bracket service, not by a coordinator: it is the shape of the bracket, not a
 * recorded result. Counting it would mean any bracket with an odd competitor
 * count could never be regenerated, which is exactly backwards — those are the
 * brackets most likely to need reseeding before play starts.
 *
 * Superseded matches are excluded too: they are the archive of a previous
 * bracket and must never block a future one.
 */
function buildActivityFilter(eventId) {
  return {
    eventId,
    isBye: false,
    status: { $ne: MATCH_STATUSES.SUPERSEDED_BY_REGENERATION },
    $or: ACTIVITY_CONDITIONS,
  };
}

/* How many live matches a person has recorded something on. */
async function countMatchesWithActivity(eventId) {
  return MatchModel.countDocuments(buildActivityFilter(eventId));
}



module.exports = { countMatchesWithActivity };
