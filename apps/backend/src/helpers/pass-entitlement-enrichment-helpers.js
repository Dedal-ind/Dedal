const { RegistrationModel } = require("../models/registration-model");
const { EventModel } = require("../models/event-model");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { EVENT_STATUSES } = require("../constants/event-constants");

/*
 * Which registration statuses may lend their team name to a pass entitlement.
 *
 * The question this list answers is "is this person still on that team for that
 * event", NOT "does this row hold a seat" — so it is deliberately wider than
 * ACTIVE_REGISTRATION_STATUSES. A participant who has already competed
 * (attended, advancedToSemiFinal, winner1st, eliminated) is still the member of
 * the team whose name the pass should print; narrowing to confirmed/waitlisted
 * would blank the team name the moment a coordinator marked them present.
 *
 * Excluded, and why: CANCELLED and EVENT_CANCELLED ended the participation, so
 * the pass must not keep advertising a team the holder walked away from or an
 * event that stopped existing. PENDING_PAYMENT has not bought the seat yet and
 * PAYMENT_EXPIRED never did, so neither has a team standing to show.
 *
 * Built by subtraction rather than by listing: a status added to the lifecycle
 * later is included by default, which is the safe direction — a new
 * progression status keeps the name, and only a new *ending* status needs a
 * line here.
 */
const TEAM_NAME_EXCLUDED_REGISTRATION_STATUSES = Object.freeze([
  REGISTRATION_STATUSES.CANCELLED,
  REGISTRATION_STATUSES.EVENT_CANCELLED,
  REGISTRATION_STATUSES.PENDING_PAYMENT,
  REGISTRATION_STATUSES.PAYMENT_EXPIRED,
]);

const TEAM_NAME_REGISTRATION_STATUSES = Object.freeze(
  Object.values(REGISTRATION_STATUSES).filter(
    (status) => !TEAM_NAME_EXCLUDED_REGISTRATION_STATUSES.includes(status)
  )
);

/* A round the participant can no longer be sent to is not the "active" one. */
const ROUND_EXCLUDED_EVENT_STATUSES = Object.freeze([
  EVENT_STATUSES.CANCELLED,
  EVENT_STATUSES.DELETED,
]);

const ROUND_RELEVANCE_STATUSES = Object.freeze({
  UPCOMING: "upcoming",
  LIVE: "live",
  COMPLETED: "completed",
});

/*
 * eventId -> teamName, for the pass holder's TEAM registrations only.
 *
 * WHY THIS IS A READ-TIME JOIN AND NOT A FIELD ON THE ENTITLEMENT: a team can be
 * renamed at any time, and a copy written onto the entitlement at registration
 * time would drift from the team document the instant that happened — the pass
 * would print a name the coordinator's roster no longer knows. There is exactly
 * one place a team's name lives, and this reads it.
 *
 * There is no edge from an entitlement to a registration — registration-model
 * carries no passId. The join is therefore (pass owner, entitlement's event):
 * entitlement.referenceId is the eventId and pass.userId is the participant, and
 * that pair is the registration's unique key.
 *
 * ONE round trip: the $lookup resolves the team name inside the same aggregate,
 * where a find().populate("teamId") would have been two.
 */
async function buildTeamNameByEventId(userId, eventIds) {
  if (eventIds.length === 0) return new Map();

  const teamRegistrations = await RegistrationModel.aggregate([
    {
      $match: {
        userId,
        eventId: { $in: eventIds },
        // A solo registration has no teamId, and its entitlement wants null —
        // so it is excluded here rather than looked up and discarded.
        teamId: { $ne: null },
        status: { $in: TEAM_NAME_REGISTRATION_STATUSES },
      },
    },
    { $lookup: { from: "teams", localField: "teamId", foreignField: "_id", as: "team" } },
    { $unwind: "$team" },
    { $project: { _id: 0, eventId: 1, teamName: "$team.teamName" } },
  ]);

  return new Map(
    teamRegistrations.map((registration) => [
      String(registration.eventId),
      registration.teamName,
    ])
  );
}

/*
 * Which of an event's rounds matters to the holder right now.
 *
 * Live beats everything (that is where they must be standing); with nothing
 * live the next one to start is what they need to know; with nothing left to
 * start, the last one that finished is the only meaningful answer.
 */
function selectRelevantRound(rounds, now) {
  const liveRound = rounds.find((round) => round.startsAt <= now && now <= round.endsAt);
  if (liveRound) {
    return { round: liveRound, status: ROUND_RELEVANCE_STATUSES.LIVE };
  }

  const upcomingRound = rounds.find((round) => round.startsAt > now);
  if (upcomingRound) {
    return { round: upcomingRound, status: ROUND_RELEVANCE_STATUSES.UPCOMING };
  }

  const completedRound = rounds[rounds.length - 1];
  if (completedRound) {
    return { round: completedRound, status: ROUND_RELEVANCE_STATUSES.COMPLETED };
  }
  return null;
}

/*
 * eventId -> the one round to show, or nothing when the event has no rounds.
 *
 * WHICH "ROUND": a round IS a child Event (Event.parentEventId), not a row in
 * the separate Round collection. Two reasons, and they point the same way.
 * First, the rest of the platform already treats the child events of an event as
 * its rounds — the hierarchy endpoints, the schedule and the frontend all read
 * them that way, and a pass that meant something else by the word would be the
 * only screen in the product that did. Second, the Round collection is a
 * coordinator's scoring artefact: it has a roundNumber, a roster and scores, but
 * NO startsAt, endsAt or venue — the three fields this feature exists to show.
 * It literally cannot answer "where and when is your next round".
 *
 * Rounds are NOT entitlements of their own: ensurePassAndEventEntitlement issues
 * exactly one eventEntry row, against the event that was registered for, so a
 * round is entered on the parent's entitlement. That is why this is derived at
 * read time and nothing is written to the entitlement model.
 *
 * ONE query for every event on the pass, sorted in the database so the selection
 * below is a scan of an already-ordered list.
 */
async function buildActiveRoundByEventId(eventIds, now = new Date()) {
  if (eventIds.length === 0) return new Map();

  const childEvents = await EventModel.find({
    parentEventId: { $in: eventIds },
    status: { $nin: ROUND_EXCLUDED_EVENT_STATUSES },
  })
    .select("eventName venue startsAt endsAt parentEventId")
    .sort({ startsAt: 1, _id: 1 })
    .lean();

  const roundsByEventId = new Map();
  for (const childEvent of childEvents) {
    const parentKey = String(childEvent.parentEventId);
    if (!roundsByEventId.has(parentKey)) roundsByEventId.set(parentKey, []);
    roundsByEventId.get(parentKey).push(childEvent);
  }

  const activeRoundByEventId = new Map();
  for (const [parentKey, rounds] of roundsByEventId) {
    const selection = selectRelevantRound(rounds, now);
    if (!selection) continue;
    activeRoundByEventId.set(parentKey, {
      // A child event's name is eventName, so that is what it is called here.
      // The Round collection's roundName belongs to a different concept.
      eventName: selection.round.eventName,
      venue: selection.round.venue ?? null,
      startsAt: selection.round.startsAt,
      endsAt: selection.round.endsAt,
      status: selection.status,
    });
  }
  return activeRoundByEventId;
}

module.exports = {
  buildTeamNameByEventId,
  buildActiveRoundByEventId,
  TEAM_NAME_REGISTRATION_STATUSES,
  ROUND_RELEVANCE_STATUSES,
};
