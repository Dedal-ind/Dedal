// round-scoreboard.js
// The ranking rule for the admin result board, in one place.
//
// It lives here rather than inside the board because the CERTIFICATE screen
// needs the identical answer: "winners" on the certificate checklist are the
// board's top scorers, and a second implementation of the sort would eventually
// disagree with the board about who won — which is the one disagreement this
// product cannot survive.

/*
 * GET /fests/:festId/events/:eventId/rounds/scoreboard returns
 *   { event, rounds: [{ id, roundNumber, roundName, status }],
 *     rows:   [{ participantUserId, fullName, teamName, isTeam, members,
 *                cells: [{ roundId, score, wasInRound, isAdminEdited }],
 *                totalScore, hasAnyScore }] }
 */
export const ROUND_SCOREBOARD_PATH = (festId, eventId) =>
  `/fests/${festId}/events/${eventId}/rounds/scoreboard`;

/* One row's total, recomputed in the client so an inline edit re-ranks the board
 * immediately rather than after a round trip. Must match the server's rule: a
 * null cell contributes nothing, NOT zero. */
export function computeRowTotal(cells = []) {
  return cells.reduce(
    (total, cell) => total + (typeof cell.score === 'number' ? cell.score : 0),
    0,
  );
}

/*
 * Ranks the board.
 *
 * UNSCORED ROWS SINK, always. Someone nobody has marked yet totals 0 by absence,
 * and sorting them purely by total would seat them level with a competitor who
 * genuinely scored 0 — and, once several are unmarked, would fill the podium
 * with people who have not competed. So `hasAnyScore` is the first sort key and
 * an unscored row never receives a rank at all.
 *
 * TIES SHARE A RANK. Two rows on the same total are both 2nd, and the row after
 * them is 4th (competition ranking). Breaking a tie arbitrarily would hand one
 * of two equal competitors a medal on the strength of their position in a
 * database cursor.
 */
export function rankScoreboardRows(rows = []) {
  const withTotals = rows.map((row) => ({
    ...row,
    totalScore: computeRowTotal(row.cells),
    hasAnyScore: (row.cells ?? []).some((cell) => typeof cell.score === 'number'),
  }));

  const sorted = [...withTotals].sort((first, second) => {
    if (first.hasAnyScore !== second.hasAnyScore) {
      return first.hasAnyScore ? -1 : 1;
    }
    if (second.totalScore !== first.totalScore) {
      return second.totalScore - first.totalScore;
    }
    // A stable, meaningless tie-break for display order only — both rows still
    // carry the SAME rank number, assigned below.
    return (first.teamName ?? first.fullName ?? '').localeCompare(
      second.teamName ?? second.fullName ?? '',
    );
  });

  let lastTotal = null;
  let lastRank = 0;
  return sorted.map((row, index) => {
    if (!row.hasAnyScore) {
      return { ...row, rank: null };
    }
    if (lastTotal === null || row.totalScore !== lastTotal) {
      lastRank = index + 1;
      lastTotal = row.totalScore;
    }
    return { ...row, rank: lastRank };
  });
}

/* The display name for a row: the team for a team event, the person for a solo
 * one — exactly what the scoreboard payload provides. */
export function scoreboardRowName(row) {
  return row.teamName ?? row.fullName ?? '—';
}

/*
 * Every userId a row stands for. A TEAM row earns its certificate for every
 * member, not just the leader it is anchored on; a solo row is itself.
 */
export function scoreboardRowUserIds(row) {
  if (row.isTeam && Array.isArray(row.members) && row.members.length > 0) {
    return row.members.map((member) => String(member.participantUserId));
  }
  return [String(row.participantUserId)];
}
