const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { UserModel } = require("../models/user-model");
const { TeamModel } = require("../models/team-model");
const { RegistrationModel } = require("../models/registration-model");
const { RoundModel } = require("../models/round-model");
const { RoundScoreModel } = require("../models/round-score-model");
const { EventScoreModel } = require("../models/event-score-model");
/* Required for its side effect: the winner reads populate collegeId with an
   explicit model: "College", which throws unless the schema is registered. */
require("../models/college-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const roundService = require("./round-service");

/*
 * The results board's data, at whichever of THREE LEVELS the caller asked for.
 *
 * The level is not a parameter — it is DERIVED from the shape of the hierarchy
 * at the requested scope, because that is the only definition both halves of the
 * product can agree on:
 *
 *   no eventId                → 'winners' over every leaf event of the fest
 *   eventId with children     → 'winners' over that event's direct children
 *   eventId with no children  → 'scoreboard', the full round-by-round grid
 *
 * Deriving it here rather than letting the client say "give me level 2" means a
 * main event that gains its first vertical stops being a scoreboard and starts
 * being a winners table on the next request, with nothing to update on the
 * client. The client's job is to render what came back, which is why the payload
 * announces its own `level`.
 *
 * CONTAINERS ARE NOT ROWS. A grouping event holds verticals, not competitors: it
 * has no registrations and can never have a winner, so a winners table that
 * listed it would carry a row that is permanently "Pending" and can never become
 * anything else. Level 1 therefore lists the fest's LEAF events — the events
 * people actually compete in — which for a two-layer fest is simply all of them.
 */

const PLACEMENT_BY_STATUS = {
  [REGISTRATION_STATUSES.WINNER_1ST]: 1,
  [REGISTRATION_STATUSES.WINNER_2ND]: 2,
  [REGISTRATION_STATUSES.WINNER_3RD]: 3,
};
const WINNER_STATUSES = Object.keys(PLACEMENT_BY_STATUS);
const PODIUM_SIZE = 3;

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).select("_id festName festSlug").lean()
    : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

async function loadEventInFestOrThrow(festId, eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId)
    ? await EventModel.findOne({ _id: eventId, festId }).lean()
    : null;
  if (!event) {
    // Same 404 as a missing event, so the endpoint cannot be used to discover
    // which event ids exist under other fests.
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

/*
 * Which events the requested scope actually resolves to, and at which level.
 * One read of the fest's events serves both questions — the parent/child
 * relation is the whole of the decision, and a second query to ask "does this
 * have children?" would be reading the same collection twice.
 */
async function resolveScope(fest, eventId) {
  const events = await EventModel.find({ festId: fest._id })
    .select("eventName parentEventId siblingRank startsAt category status")
    // The structure editor's order: sibling rank, _id as the stable tiebreaker.
    // Sorting the whole fest by a per-level key is sound because the rows are
    // grouped by parent below, and within any one group the order is right.
    .sort({ siblingRank: 1, _id: 1 })
    .lean();

  const childrenByParentId = new Map();
  for (const event of events) {
    const parentKey = event.parentEventId ? String(event.parentEventId) : null;
    if (!childrenByParentId.has(parentKey)) {
      childrenByParentId.set(parentKey, []);
    }
    childrenByParentId.get(parentKey).push(event);
  }
  const hasChildren = (event) => (childrenByParentId.get(String(event._id)) ?? []).length > 0;

  if (!eventId) {
    return {
      level: "winners",
      scopeEvent: null,
      scopeName: fest.festName,
      events: events.filter((event) => !hasChildren(event)),
    };
  }

  const event = await loadEventInFestOrThrow(fest._id, eventId);
  const children = childrenByParentId.get(String(event._id)) ?? [];
  if (children.length > 0) {
    return { level: "winners", scopeEvent: event, scopeName: event.eventName, events: children };
  }
  return { level: "scoreboard", scopeEvent: event, scopeName: event.eventName, events: [event] };
}

/*
 * Who is on each podium, for a whole set of events at once.
 *
 * THREE SOURCES, IN ORDER OF AUTHORITY, and the first that answers for an event
 * wins:
 *   1. The stamped verdict — registrations carrying winner1st/2nd/3rd, written
 *      when a coordinator finalises the rounds or a bracket final resolves. This
 *      is a DECISION someone made, including any manual override, so it outranks
 *      anything recomputed from marks.
 *   2. Round totals, for an event whose marks are in but whose result has not
 *      been finalised yet. Provisional, and labelled as such in the payload.
 *   3. EventScore totals, the single-running-score collection used by events
 *      that never created rounds.
 *
 * Every source is read in BATCH for the whole event set — three queries and a
 * handful of maps, not three queries per event. A forty-event fest would
 * otherwise cost a hundred and twenty round trips to draw one table.
 */
async function buildWinnersByEventId(eventIds) {
  if (eventIds.length === 0) {
    return new Map();
  }

  const winnersByEventId = new Map(eventIds.map((eventId) => [String(eventId), null]));

  /* 1 — the stamped verdict. */
  const winnerRegistrations = await RegistrationModel.find({
    eventId: { $in: eventIds },
    status: { $in: WINNER_STATUSES },
  })
    .populate({ path: "userId", select: "fullName collegeId", populate: { path: "collegeId", select: "commonName", model: "College" } })
    .populate({ path: "teamId", select: "teamName" })
    .lean();

  for (const registration of winnerRegistrations) {
    const key = String(registration.eventId);
    if (!winnersByEventId.has(key)) {
      continue;
    }
    const podium = winnersByEventId.get(key) ?? { isProvisional: false, places: new Map() };
    const placement = PLACEMENT_BY_STATUS[registration.status];
    /* A tie shares a placement, so the first row read holds the slot and the
       rest are dropped rather than overwriting it — the table has one cell. */
    if (!podium.places.has(placement)) {
      podium.places.set(placement, {
        placement,
        name: registration.teamId?.teamName ?? registration.userId?.fullName ?? null,
        college: registration.userId?.collegeId?.commonName ?? null,
      });
    }
    winnersByEventId.set(key, podium);
  }

  const undecidedEventIds = eventIds.filter((eventId) => !winnersByEventId.get(String(eventId)));
  if (undecidedEventIds.length === 0) {
    return winnersByEventId;
  }

  /* 2 — provisional standings from round marks. */
  const rounds = await RoundModel.find({ eventId: { $in: undecidedEventIds } })
    .select("_id eventId")
    .lean();
  const eventIdByRoundId = new Map(rounds.map((round) => [String(round._id), String(round.eventId)]));

  const totalsByEventId = new Map();
  if (rounds.length > 0) {
    const roundScores = await RoundScoreModel.find({
      roundId: { $in: rounds.map((round) => round._id) },
      score: { $ne: null },
    })
      .select("roundId participantUserId score")
      .lean();
    for (const row of roundScores) {
      const eventKey = eventIdByRoundId.get(String(row.roundId));
      if (!eventKey) {
        continue;
      }
      if (!totalsByEventId.has(eventKey)) {
        totalsByEventId.set(eventKey, new Map());
      }
      const byUser = totalsByEventId.get(eventKey);
      const userKey = String(row.participantUserId);
      byUser.set(userKey, (byUser.get(userKey) ?? 0) + row.score);
    }
  }

  /* 3 — the single-running-score collection, for events with no rounds at all. */
  const eventIdsWithoutRoundTotals = undecidedEventIds.filter(
    (eventId) => !totalsByEventId.has(String(eventId))
  );
  const eventScoreRows = eventIdsWithoutRoundTotals.length
    ? await EventScoreModel.find({ eventId: { $in: eventIdsWithoutRoundTotals } })
        .select("eventId userId teamId score")
        .populate({ path: "userId", select: "fullName collegeId", populate: { path: "collegeId", select: "commonName", model: "College" } })
        .populate({ path: "teamId", select: "teamName" })
        .lean()
    : [];

  for (const eventId of eventIdsWithoutRoundTotals) {
    const rows = eventScoreRows
      .filter((row) => String(row.eventId) === String(eventId) && typeof row.score === "number")
      .sort((first, second) => second.score - first.score)
      .slice(0, PODIUM_SIZE);
    if (rows.length === 0) {
      continue;
    }
    winnersByEventId.set(String(eventId), {
      isProvisional: true,
      places: new Map(
        rows.map((row, index) => [
          index + 1,
          {
            placement: index + 1,
            name: row.teamId?.teamName ?? row.userId?.fullName ?? null,
            college: row.userId?.collegeId?.commonName ?? null,
          },
        ])
      ),
    });
  }

  /*
   * Round totals are anchored on a USER, so the names and colleges come from one
   * batched user read — and a team event's row is titled with the team, matching
   * what the scoreboard grid itself shows for the same competitor.
   */
  const podiumUserIdsByEventId = new Map();
  const allPodiumUserIds = new Set();
  for (const [eventKey, byUser] of totalsByEventId) {
    const top = [...byUser.entries()]
      .sort((first, second) => second[1] - first[1])
      .slice(0, PODIUM_SIZE);
    podiumUserIdsByEventId.set(eventKey, top);
    top.forEach(([userId]) => allPodiumUserIds.add(userId));
  }

  if (allPodiumUserIds.size > 0) {
    const users = await UserModel.find({ _id: { $in: [...allPodiumUserIds] } })
      .select("fullName collegeId")
      .populate({ path: "collegeId", select: "commonName", model: "College" })
      .lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const teamRegistrations = await RegistrationModel.find({
      eventId: { $in: [...totalsByEventId.keys()].map((key) => new mongoose.Types.ObjectId(key)) },
      userId: { $in: [...allPodiumUserIds] },
      teamId: { $ne: null },
    })
      .select("eventId userId teamId")
      .populate({ path: "teamId", select: "teamName" })
      .lean();
    const teamNameByEventAndUser = new Map(
      teamRegistrations.map((registration) => [
        `${String(registration.eventId)}:${String(registration.userId)}`,
        registration.teamId?.teamName ?? null,
      ])
    );

    for (const [eventKey, top] of podiumUserIdsByEventId) {
      winnersByEventId.set(eventKey, {
        isProvisional: true,
        places: new Map(
          top.map(([userId], index) => {
            const user = userById.get(userId);
            return [
              index + 1,
              {
                placement: index + 1,
                name:
                  teamNameByEventAndUser.get(`${eventKey}:${userId}`) ?? user?.fullName ?? null,
                college: user?.collegeId?.commonName ?? null,
              },
            ];
          })
        ),
      });
    }
  }

  return winnersByEventId;
}

function serialisePodium(podium) {
  const place = (placement) => podium?.places.get(placement) ?? null;
  return {
    first: place(1),
    second: place(2),
    third: place(3),
    isProvisional: Boolean(podium?.isProvisional),
  };
}

/*
 * Level 3. The grid the admin already reads and corrects, reshaped into the flat
 * per-participant rows an export wants: one row, one column per round, a total.
 *
 * It delegates to roundService.getRoundScoreboard rather than re-reading the
 * rounds itself, so the ranking here and the ranking on the editable grid cannot
 * drift — a downloaded scoreboard that disagreed with the screen it was
 * downloaded from would be worse than no download at all.
 */
function rankScoreboardRows(rows) {
  const sorted = [...rows].sort((first, second) => {
    if (first.hasAnyScore !== second.hasAnyScore) {
      return first.hasAnyScore ? -1 : 1;
    }
    if (second.totalScore !== first.totalScore) {
      return second.totalScore - first.totalScore;
    }
    return (first.teamName ?? first.fullName ?? "").localeCompare(
      second.teamName ?? second.fullName ?? ""
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

async function buildScoreboard(event) {
  const board = await roundService.getRoundScoreboard(String(event._id));
  const ranked = rankScoreboardRows(board.rows ?? []);

  return {
    level: "scoreboard",
    eventId: String(event._id),
    eventName: event.eventName,
    resultsFinalisedAt: board.event?.resultsFinalisedAt ?? null,
    rounds: (board.rounds ?? []).map((round) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      roundName: round.roundName ?? `Round ${round.roundNumber}`,
    })),
    participants: ranked.map((row) => ({
      rank: row.rank,
      name: row.teamName ?? row.fullName ?? null,
      teamName: row.teamName ?? null,
      college: row.collegeName ?? null,
      /* Keyed by ROUND ID, not by "round1": a round can be renamed or inserted,
         and a positional key would silently re-point every score when it is. */
      scores: Object.fromEntries((row.cells ?? []).map((cell) => [cell.roundId, cell.score])),
      total: row.hasAnyScore ? row.totalScore : null,
    })),
  };
}

async function buildWinnersTable(scope) {
  const eventIds = scope.events.map((event) => event._id);
  const winnersByEventId = await buildWinnersByEventId(eventIds);

  return {
    level: "winners",
    scopeEventId: scope.scopeEvent ? String(scope.scopeEvent._id) : null,
    scopeName: scope.scopeName,
    events: scope.events.map((event) => ({
      eventId: String(event._id),
      eventName: event.eventName,
      category: event.category ?? null,
      status: event.status,
      winners: serialisePodium(winnersByEventId.get(String(event._id))),
    })),
  };
}

/* The read endpoint. One call answers whichever level the scope resolves to. */
async function getFestResults(festId, eventId) {
  const fest = await loadFestOrThrow(festId);
  const scope = await resolveScope(fest, eventId);

  if (scope.level === "scoreboard") {
    return { festId: String(fest._id), festName: fest.festName, ...(await buildScoreboard(scope.scopeEvent)) };
  }
  return { festId: String(fest._id), festName: fest.festName, ...(await buildWinnersTable(scope)) };
}

/*
 * The download. Built from the SAME resolver and the same builders as the read,
 * so a CSV can never describe a different level, a different event set or a
 * different ranking from the table it was downloaded beside.
 */
const WINNERS_CSV_HEADERS = [
  "Event Name",
  "1st Place Name",
  "1st Place College",
  "2nd Place Name",
  "2nd Place College",
  "3rd Place Name",
  "3rd Place College",
];

async function buildResultsCsv(festId, eventId) {
  const fest = await loadFestOrThrow(festId);
  const scope = await resolveScope(fest, eventId);

  if (scope.level === "scoreboard") {
    const scoreboard = await buildScoreboard(scope.scopeEvent);
    const headers = [
      "Rank",
      "Participant/Team",
      "College",
      ...scoreboard.rounds.map((round) => round.roundName),
      "Total",
    ];
    const rows = scoreboard.participants.map((participant) => [
      participant.rank ?? "",
      participant.name ?? "",
      participant.college ?? "",
      ...scoreboard.rounds.map((round) => {
        const score = participant.scores[round.id];
        return typeof score === "number" ? score : "";
      }),
      participant.total ?? "",
    ]);
    return { scope: `scoreboard-${scoreboard.eventName}`, festSlug: fest.festSlug, headers, rows };
  }

  const table = await buildWinnersTable(scope);
  const rows = table.events.map((event) => [
    event.eventName,
    event.winners.first?.name ?? "",
    event.winners.first?.college ?? "",
    event.winners.second?.name ?? "",
    event.winners.second?.college ?? "",
    event.winners.third?.name ?? "",
    event.winners.third?.college ?? "",
  ]);
  return { scope: `winners-${table.scopeName}`, festSlug: fest.festSlug, headers: WINNERS_CSV_HEADERS, rows };
}

module.exports = { getFestResults, buildResultsCsv };
