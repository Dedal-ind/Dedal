/*
 * The vocabulary of a bracket match. A match belongs to one bracket event and
 * one round; the model, the bracket service, and later the UI all read these
 * enums from here rather than re-declaring them.
 */

/* How a result was decided. Optional on a match: a plain winner needs none. */
const DECISION_TYPES = {
  UNANIMOUS: "unanimous",
  SPLIT: "split",
  TKO: "TKO",
  KO: "KO",
  WALKOVER: "walkover",
  DISQUALIFICATION: "disqualification",
  FORFEIT: "forfeit",
};

/* Which slot of the next-round match a winner feeds into. */
const NEXT_MATCH_SLOTS = {
  A: "A",
  B: "B",
};

/*
 * A match is live until an administrator force-regenerates the bracket over the
 * top of it, at which point it is superseded rather than removed. Matches are
 * permanent history per PRODUCT-SPEC: a certificate, an audit entry, or a
 * dispute may point at a match years later, and a row that has been deleted can
 * answer none of them. Reads filter to ACTIVE unless an admin asks otherwise.
 */
const MATCH_STATUSES = {
  ACTIVE: "active",
  SUPERSEDED_BY_REGENERATION: "supersededByRegeneration",
};

const {
  REGISTRATION_STATUSES,
} = require("./registration-constants");

/*
 * The registration status a competitor earns by winning a match. It names the
 * round they have *reached* — winning round N puts them into round N+1 — and, as
 * with the labels, prefers Final/Semi/Quarter near the end and falls back to
 * "advanced to round N" otherwise. Winning the final is not an advancement: that
 * competitor is the champion, handled by the caller as winner1st.
 */
function computeAdvancementStatus(reachedRound, totalRounds) {
  const roundsFromFinal = totalRounds - reachedRound;
  if (roundsFromFinal === 0) {
    return REGISTRATION_STATUSES.ADVANCED_TO_FINAL;
  }
  if (roundsFromFinal === 1) {
    return REGISTRATION_STATUSES.ADVANCED_TO_SEMI_FINAL;
  }
  if (roundsFromFinal === 2) {
    return REGISTRATION_STATUSES.ADVANCED_TO_QUARTER_FINAL;
  }
  if (reachedRound === 3) {
    return REGISTRATION_STATUSES.ADVANCED_TO_R3;
  }
  return REGISTRATION_STATUSES.ADVANCED_TO_R2;
}

/*
 * A human label for a round, derived from how far the round sits from the final
 * rather than from its number alone: the last round is always "Final", the one
 * before it "Semi-Final", and so on, with early rounds falling back to "Round N".
 */
function getRoundLabel(roundNumber, totalRounds) {
  const roundsFromFinal = totalRounds - roundNumber;
  if (roundsFromFinal === 0) {
    return "Final";
  }
  if (roundsFromFinal === 1) {
    return "Semi-Final";
  }
  if (roundsFromFinal === 2) {
    return "Quarter-Final";
  }
  return `Round ${roundNumber}`;
}


module.exports = {
  DECISION_TYPES,
  NEXT_MATCH_SLOTS,
  MATCH_STATUSES,
  getRoundLabel,
  computeAdvancementStatus,
};
