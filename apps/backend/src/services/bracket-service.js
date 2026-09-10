const mongoose = require("mongoose");

const { MatchModel } = require("../models/match-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_TYPES, EVENT_SCORING_FORMATS } = require("../constants/event-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const {
  NEXT_MATCH_SLOTS,
  MATCH_STATUSES,
  computeAdvancementStatus,
} = require("../constants/match-constants");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const {
  assertMatchVersionOrConflict,
  stampMatchWrite,
} = require("../helpers/match-version-helpers");
const { countMatchesWithActivity } = require("../helpers/bracket-activity-helpers");

const MINIMUM_COMPETITORS = 2;
const MINIMUM_REASON_LENGTH = 10;
const MAXIMUM_REASON_LENGTH = 500;

/*
 * Every read of a live bracket goes through this. A match missing the field
 * altogether predates the status column and is live, so this is $ne rather than
 * an equality test on ACTIVE — an archived match is only ever one that was
 * explicitly stamped as such.
 */
const LIVE_MATCH_FILTER = { status: { $ne: MATCH_STATUSES.SUPERSEDED_BY_REGENERATION } };

/*
 * Names only. The bracket is readable by any authenticated user by design — a
 * participant checks their own position — so anything selected here is public to
 * every account in the system. emailAddress and usn were selected and never
 * rendered, which made a roster of competitor emails readable by anyone with a
 * login. A bracket needs a name to print and an id to compare; it needs nothing
 * else, and winnerUserId below has always known that.
 */
const BRACKET_POPULATE = [
  { path: "participantAUserId", select: "fullName" },
  { path: "participantBUserId", select: "fullName" },
  { path: "participantATeamId", select: "teamName" },
  { path: "participantBTeamId", select: "teamName" },
  { path: "winnerUserId", select: "fullName" },
  { path: "winnerTeamId", select: "teamName" },
  { path: "lastUpdatedByUserId", select: "fullName" },
];

/*
 * The competitor sides stay populated objects — callers have always read
 * participantAUserId.fullName off them. lastUpdatedBy is flattened instead: a
 * client only ever wants the id and a name to print, and splitting them keeps
 * lastUpdatedByUserId a plain string it can compare without unwrapping.
 *
 * lastUpdatedAt is the doc's updatedAt, but only once someone has actually
 * written: every match has an updatedAt from the moment it is generated, and
 * reporting that as an edit would put a timestamp on matches nobody has touched.
 */
function toMatchJson(matchDocument) {
  const plainMatch = matchDocument.toJSON();
  const editor = plainMatch.lastUpdatedByUserId;
  return {
    ...plainMatch,
    lastUpdatedByUserId: editor ? String(editor.id || editor) : null,
    lastUpdatedByFullName: editor && editor.fullName ? editor.fullName : null,
    lastUpdatedAt: editor ? plainMatch.updatedAt : null,
  };
}

/* The populated conflict payload: what the caller should have been looking at. */
async function loadMatchJson(matchId) {
  const match = await MatchModel.findById(matchId).populate(BRACKET_POPULATE);
  return match ? toMatchJson(match) : null;
}

/*
 * The bracket is always padded up to the next power of two, so its rounds halve
 * cleanly down to a single final. totalRounds is the number of halvings.
 */
function computeBracketShape(count) {
  let bracketSize = 1;
  let totalRounds = 0;
  while (bracketSize < count) {
    bracketSize *= 2;
    totalRounds += 1;
  }
  return { bracketSize, totalRounds };
}

function toCompetitor(id, isTeamEvent) {
  const objectId = new mongoose.Types.ObjectId(id);
  return isTeamEvent ? { userId: null, teamId: objectId } : { userId: objectId, teamId: null };
}

/*
 * The $set fields for one slot only, so a targeted findOneAndUpdate touches just
 * this slot's competitor pair. Two concurrent advances into the two slots of the
 * same next match then write disjoint fields and cannot overwrite each other.
 */
function slotSetFields(slot, competitor) {
  if (slot === NEXT_MATCH_SLOTS.A) {
    return { participantAUserId: competitor.userId, participantATeamId: competitor.teamId };
  }
  return { participantBUserId: competitor.userId, participantBTeamId: competitor.teamId };
}

/*
 * Round-one placement. Every match gets an A competitor first; the leftover
 * competitors then fill B on the earliest matches, and the matches with no B are
 * byes. Because the bracket is the next power of two, byes are always fewer than
 * the round-one match count, so no match is left completely empty.
 */
function buildFirstRoundDocuments(eventId, competitors, bracketSize, totalRounds) {
  const firstRoundMatchCount = bracketSize / 2;
  const documents = [];
  for (let index = 0; index < firstRoundMatchCount; index += 1) {
    const matchNumberInRound = index + 1;
    const competitorA = competitors[index] || null;
    const competitorB = competitors[firstRoundMatchCount + index] || null;
    const isBye = Boolean(competitorA) && !competitorB;
    documents.push(
      buildMatchDocument(eventId, 1, matchNumberInRound, totalRounds, {
        competitorA,
        competitorB,
        isBye,
      })
    );
  }
  return documents;
}

function buildMatchDocument(eventId, roundNumber, matchNumberInRound, totalRounds, options = {}) {
  const { competitorA = null, competitorB = null, isBye = false } = options;
  const isFinalRound = roundNumber === totalRounds;
  const document = {
    eventId,
    roundNumber,
    matchNumberInRound,
    participantAUserId: competitorA ? competitorA.userId : null,
    participantATeamId: competitorA ? competitorA.teamId : null,
    participantBUserId: competitorB ? competitorB.userId : null,
    participantBTeamId: competitorB ? competitorB.teamId : null,
    isBye,
    nextMatchNumberInRound: isFinalRound ? null : Math.ceil(matchNumberInRound / 2),
    nextMatchSlot: isFinalRound
      ? null
      : matchNumberInRound % 2 === 1
        ? NEXT_MATCH_SLOTS.A
        : NEXT_MATCH_SLOTS.B,
  };
  return document;
}

function buildEmptyRounds(eventId, bracketSize, totalRounds) {
  const documents = [];
  for (let roundNumber = 2; roundNumber <= totalRounds; roundNumber += 1) {
    const matchCount = bracketSize / 2 ** roundNumber;
    for (let matchNumberInRound = 1; matchNumberInRound <= matchCount; matchNumberInRound += 1) {
      documents.push(buildMatchDocument(eventId, roundNumber, matchNumberInRound, totalRounds));
    }
  }
  return documents;
}

async function loadEventOrThrow(festId, eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId) ? await EventModel.findById(eventId) : null;
  if (!event || (festId && event.festId.toString() !== String(festId))) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

/*
 * A superseded match is history and is not writable: it reads as gone, exactly
 * as it does on the bracket. Answering 404 rather than a bespoke code keeps a
 * stale client — one holding a match id from a bracket that has since been
 * regenerated under it — on the path it already handles.
 */
async function loadMatchOrThrow(eventId, matchId) {
  const match = mongoose.Types.ObjectId.isValid(matchId) ? await MatchModel.findById(matchId) : null;
  if (
    !match ||
    match.eventId.toString() !== String(eventId) ||
    match.status === MATCH_STATUSES.SUPERSEDED_BY_REGENERATION
  ) {
    throw new ApplicationError(404, ERROR_CODES.MATCH_NOT_FOUND, "Match not found.");
  }
  return match;
}

async function getTotalRounds(eventId) {
  const deepestMatch = await MatchModel.findOne({ eventId, ...LIVE_MATCH_FILTER })
    .sort({ roundNumber: -1 })
    .select("roundNumber")
    .lean();
  return deepestMatch ? deepestMatch.roundNumber : 0;
}

/*
 * Archives every live match of an event. Nothing is removed: the rows keep their
 * results and drop out of reads, which is the only way a certificate or a
 * dispute raised months later can still be answered.
 */
async function supersedeLiveMatches(eventId, actorUserId) {
  /*
   * Stamped inline rather than through stampMatchWrite: that helper works on a
   * loaded document and this is one bulk write over the whole bracket. The
   * invariant it enforces still holds without exception — no match mutates
   * without a version bump — and this was the one write that skipped it.
   *
   * lastUpdatedByUserId names the administrator who forced the regeneration,
   * for the same reason auto-advancement names the finaliser: they did not edit
   * the match by hand, but they caused the write, and a name to ask about it
   * beats an honest blank.
   */
  const outcome = await MatchModel.updateMany(
    { eventId, ...LIVE_MATCH_FILTER },
    {
      $set: {
        status: MATCH_STATUSES.SUPERSEDED_BY_REGENERATION,
        supersededAt: new Date(),
        supersededByUserId: actorUserId || null,
        lastUpdatedByUserId: actorUserId || null,
      },
      $inc: { version: 1 },
    }
  );
  return outcome.modifiedCount || 0;
}

/*
 * Decides whether a bracket may be rebuilt over the top of an existing one.
 *
 * A bracket that has been generated but never played on is safe to rebuild —
 * that is the common case of a coordinator seeding before the roster settled,
 * and refusing it would leave them stuck. Once anybody has recorded a result,
 * the rebuild is refused outright: this endpoint has no force flag, because a
 * destructive act should not be reachable by re-sending the same request with
 * one field changed. The administrator who means it goes to force-regenerate.
 *
 * Returns the number of matches archived, so the caller knows whether this was
 * a first generation or a clean rebuild worth its own audit line.
 */
async function assertRegenerationAllowedAndArchive(eventId, actorUserId) {
  const liveCount = await MatchModel.countDocuments({ eventId, ...LIVE_MATCH_FILTER });
  if (liveCount === 0) {
    return 0;
  }

  const activityCount = await countMatchesWithActivity(eventId);
  if (activityCount > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.BRACKET_HAS_ACTIVITY,
      "This bracket has recorded results and cannot be regenerated. An administrator can force regenerate if the bracket must be reset.",
      { activityCount }
    );
  }

  return supersedeLiveMatches(eventId, actorUserId);
}

/*
 * Creates every match of a single-elimination bracket. Round one is seeded from
 * the competitors; the later rounds are created empty and filled as results come
 * in. A bye is finalised on creation and its lone competitor advanced at once.
 *
 * skipRegenerationGuard is for force-regenerate only, which has already archived
 * the old bracket under an administrator's stated reason. It is not a back door
 * for the guard: with the previous matches archived there is nothing live left
 * to guard, so the flag only saves a redundant pair of queries.
 */
async function generateBracket(eventId, competitorIds, options = {}) {
  const {
    isTeamEvent = false,
    actorUserId = null,
    festId = null,
    skipRegenerationGuard = false,
    context = {},
  } = options;

  if (competitorIds.length < MINIMUM_COMPETITORS) {
    throw new ApplicationError(
      400,
      ERROR_CODES.INSUFFICIENT_PARTICIPANTS,
      "A bracket needs at least two participants.",
      { participantCount: competitorIds.length }
    );
  }

  const archivedCount = skipRegenerationGuard
    ? 0
    : await assertRegenerationAllowedAndArchive(eventId, actorUserId);

  const competitors = competitorIds.map((id) => toCompetitor(id, isTeamEvent));
  const { bracketSize, totalRounds } = computeBracketShape(competitors.length);

  const documents = [
    ...buildFirstRoundDocuments(eventId, competitors, bracketSize, totalRounds),
    ...buildEmptyRounds(eventId, bracketSize, totalRounds),
  ];
  const createdMatches = await MatchModel.insertMany(documents);
  await advanceByes(createdMatches, actorUserId);

  /*
   * A rebuild is a different event from a first generation even when nothing was
   * lost, and the count of what it displaced is the part worth keeping.
   */
  await recordAuditLog({
    actorUserId,
    festId,
    action: archivedCount > 0 ? AUDIT_ACTIONS.BRACKET_REGENERATED_CLEAN : AUDIT_ACTIONS.BRACKET_GENERATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: eventId,
    afterState: {
      competitorCount: competitors.length,
      bracketSize,
      totalRounds,
      ...(archivedCount > 0 ? { archivedMatchCount: archivedCount } : {}),
    },
    ...context,
  });

  return getBracket(eventId);
}

/*
 * A bye's competitor wins uncontested and is placed into its next-round slot.
 * These are real writes even though no coordinator typed them, so they carry a
 * version bump and the generator's name like any other — a client that read the
 * bracket mid-generation and then submitted must still be told to re-read.
 */
async function advanceByes(createdMatches, actorUserId = null) {
  const byeMatches = createdMatches.filter((match) => match.isBye);

  await Promise.all(
    byeMatches.map(async (match) => {
      const winner = { userId: match.participantAUserId, teamId: match.participantATeamId };
      // Finalise the bye itself with the same targeted-update shape rather than
      // load-modify-save, then advance through the shared path — so a future change
      // that breaks the in-memory dedup cannot reintroduce the lost-update bug.
      await MatchModel.findOneAndUpdate(
        {
          eventId: match.eventId,
          roundNumber: match.roundNumber,
          matchNumberInRound: match.matchNumberInRound,
          ...LIVE_MATCH_FILTER,
        },
        {
          $set: {
            winnerUserId: winner.userId,
            winnerTeamId: winner.teamId,
            isFinalized: true,
            lastUpdatedByUserId: actorUserId || null,
          },
          $inc: { version: 1 },
        }
      );
      await advanceWinnerToNextMatch(match, winner, actorUserId);
    })
  );
}

/*
 * The live bracket. includeSuperseded opens the archive as well, for an
 * administrator auditing what a force-regeneration threw away; it is off by
 * default so no ordinary reader ever sees a superseded match beside a live one.
 */
async function getBracket(eventId, options = {}) {
  const { includeSuperseded = false } = options;
  const filter = includeSuperseded ? { eventId } : { eventId, ...LIVE_MATCH_FILTER };
  const matches = await MatchModel.find(filter)
    .sort({ roundNumber: 1, matchNumberInRound: 1 })
    .populate(BRACKET_POPULATE);
  return matches.map(toMatchJson);
}

function resolveWinner(match, result) {
  if (result.winnerTeamId) {
    const candidate = String(result.winnerTeamId);
    const sides = [match.participantATeamId, match.participantBTeamId].filter(Boolean).map(String);
    if (!sides.includes(candidate)) {
      throw new ApplicationError(400, ERROR_CODES.INVALID_WINNER, "The winner is not in this match.");
    }
    return { userId: null, teamId: new mongoose.Types.ObjectId(candidate) };
  }
  if (result.winnerUserId) {
    const candidate = String(result.winnerUserId);
    const sides = [match.participantAUserId, match.participantBUserId].filter(Boolean).map(String);
    if (!sides.includes(candidate)) {
      throw new ApplicationError(400, ERROR_CODES.INVALID_WINNER, "The winner is not in this match.");
    }
    return { userId: new mongoose.Types.ObjectId(candidate), teamId: null };
  }
  throw new ApplicationError(400, ERROR_CODES.INVALID_WINNER, "A winner must be named.", {
    winnerUserId: "one of winnerUserId or winnerTeamId is required",
  });
}

function resolveLoser(match, winner) {
  if (winner.teamId) {
    const winnerId = String(winner.teamId);
    const loserTeamId = [match.participantATeamId, match.participantBTeamId]
      .filter(Boolean)
      .find((teamId) => String(teamId) !== winnerId);
    return loserTeamId ? { userId: null, teamId: loserTeamId } : null;
  }
  const winnerId = String(winner.userId);
  const loserUserId = [match.participantAUserId, match.participantBUserId]
    .filter(Boolean)
    .find((userId) => String(userId) !== winnerId);
  return loserUserId ? { userId: loserUserId, teamId: null } : null;
}

async function setRegistrationStatus(eventId, competitor, status) {
  if (!competitor) {
    return;
  }
  const filter = competitor.teamId
    ? { eventId, teamId: competitor.teamId }
    : { eventId, userId: competitor.userId };
  await RegistrationModel.updateMany(filter, { $set: { status } });
}

/*
 * The winner lands in the next round. This is never version-guarded: the slot is
 * a consequence of a result that has already been accepted, so there is no
 * earlier read to be stale against and nothing a refusal here could protect —
 * blocking it would leave the bracket with a decided match feeding into an empty
 * slot. It does bump the child's version, which is the point: a coordinator who
 * was part-way through entering that child's result now holds a stale version
 * and will be made to re-read before they can overwrite the advanced competitor.
 *
 * The actor is whoever finalised the parent. They did not touch the child by
 * hand, but they caused the write, and a name to ask about it is worth more to
 * the next coordinator than an honest blank.
 */
async function advanceWinnerToNextMatch(match, winner, actorUserId = null) {
  if (!match.nextMatchNumberInRound) {
    return;
  }
  // A targeted findOneAndUpdate on only this slot's fields, not load-modify-save of
  // the whole document: two coordinators advancing winners into the two different
  // slots of the same next match write disjoint fields and cannot clobber each
  // other. version bumps atomically in the same update.
  await MatchModel.findOneAndUpdate(
    {
      eventId: match.eventId,
      roundNumber: match.roundNumber + 1,
      matchNumberInRound: match.nextMatchNumberInRound,
      ...LIVE_MATCH_FILTER,
    },
    {
      $set: {
        ...slotSetFields(match.nextMatchSlot, winner),
        lastUpdatedByUserId: actorUserId || null,
      },
      $inc: { version: 1 },
    }
  );
}

/*
 * Records a result: sets the winner, scores and decision, advances the winner to
 * the next round, and rewrites the two competitors' registration statuses. A
 * finalised match is locked to coordinators; only an administrator may correct it.
 */
async function enterMatchResult(eventId, matchId, result, options = {}) {
  const {
    actorUserId = null,
    isAdministrator = false,
    festId = null,
    expectedVersion,
    context = {},
  } = options;
  const match = await loadMatchOrThrow(eventId, matchId);

  /*
   * Before the finalise lock, not after. Both refusals can apply at once to a
   * stale caller, and of the two only this one hands back the current match —
   * which carries isFinalized, so nothing is hidden by answering it first. The
   * reverse order would tell a coordinator the match is final without ever
   * showing them the result that made it so.
   */
  await assertMatchVersionOrConflict(match, expectedVersion, () => loadMatchJson(match._id));

  if (match.isFinalized && !isAdministrator) {
    throw new ApplicationError(
      409,
      ERROR_CODES.MATCH_ALREADY_FINALIZED,
      "This match is finalised and can only be corrected by an administrator."
    );
  }

  const winner = resolveWinner(match, result);
  const loser = resolveLoser(match, winner);

  match.winnerUserId = winner.userId;
  match.winnerTeamId = winner.teamId;
  if (result.participantAScore !== undefined) {
    match.participantAScore = result.participantAScore;
  }
  if (result.participantBScore !== undefined) {
    match.participantBScore = result.participantBScore;
  }
  if (result.decisionType !== undefined) {
    match.decisionType = result.decisionType || null;
  }
  if (result.scoresheetImageUrl) {
    match.scoresheetImageUrl = result.scoresheetImageUrl;
  }
  match.isFinalized = true;
  await stampMatchWrite(match, actorUserId).save();

  await advanceWinnerToNextMatch(match, winner, actorUserId);

  const totalRounds = await getTotalRounds(eventId);
  if (match.roundNumber === totalRounds) {
    await setRegistrationStatus(eventId, winner, REGISTRATION_STATUSES.WINNER_1ST);
    await setRegistrationStatus(eventId, loser, REGISTRATION_STATUSES.WINNER_2ND);
  } else {
    const advancementStatus = computeAdvancementStatus(match.roundNumber + 1, totalRounds);
    await setRegistrationStatus(eventId, winner, advancementStatus);
    await setRegistrationStatus(eventId, loser, REGISTRATION_STATUSES.ELIMINATED);
  }

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.MATCH_RESULT_ENTERED,
    entityType: AUDIT_ENTITY_TYPES.MATCH,
    entityId: match._id,
    afterState: {
      winnerUserId: winner.userId ? String(winner.userId) : null,
      winnerTeamId: winner.teamId ? String(winner.teamId) : null,
      roundNumber: match.roundNumber,
      version: match.version,
    },
    ...context,
  });

  return loadMatchJson(match._id);
}

/*
 * A coordinator may attach a scoresheet once; changing an existing one is an
 * administrator-only correction. File upload is deferred, so the URL arrives in
 * the JSON body already hosted elsewhere.
 */
async function setScoresheet(eventId, matchId, scoresheetImageUrl, options = {}) {
  const {
    actorUserId = null,
    isAdministrator = false,
    festId = null,
    expectedVersion,
    judgeNames,
    context = {},
  } = options;
  const match = await loadMatchOrThrow(eventId, matchId);

  await assertMatchVersionOrConflict(match, expectedVersion, () => loadMatchJson(match._id));

  /* The attach-once rule is about the sheet; judges stay correctable. */
  if (scoresheetImageUrl && match.scoresheetImageUrl && !isAdministrator) {
    throw new ApplicationError(
      409,
      ERROR_CODES.SCORESHEET_ALREADY_SET,
      "A scoresheet is already attached; only an administrator can replace it."
    );
  }

  /*
   * The two move independently: a sheet can arrive before the judges are
   * confirmed, and a judging panel can be corrected without re-uploading
   * anything. undefined means "not sent"; an empty array means "clear them".
   */
  if (scoresheetImageUrl) {
    match.scoresheetImageUrl = scoresheetImageUrl;
  }
  if (judgeNames !== undefined) {
    match.judgeNames = judgeNames;
  }
  await stampMatchWrite(match, actorUserId).save();

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.MATCH_SCORESHEET_UPLOADED,
    entityType: AUDIT_ENTITY_TYPES.MATCH,
    entityId: match._id,
    afterState: { scoresheetImageUrl, judgeNames: match.judgeNames, version: match.version },
    ...context,
  });

  return loadMatchJson(match._id);
}

/* The competitors for an event, drawn from its confirmed registrations. */
async function collectCompetitors(event) {
  const isTeamEvent = event.eventType === EVENT_TYPES.TEAM;
  const registrations = await RegistrationModel.find({
    eventId: event._id,
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .sort({ registeredAt: 1 })
    .lean();

  if (isTeamEvent) {
    const seenTeamIds = new Set();
    const competitorIds = [];
    for (const registration of registrations) {
      if (registration.teamId && !seenTeamIds.has(String(registration.teamId))) {
        seenTeamIds.add(String(registration.teamId));
        competitorIds.push(registration.teamId);
      }
    }
    return { competitorIds, isTeamEvent };
  }

  return { competitorIds: registrations.map((registration) => registration.userId), isTeamEvent };
}

/*
 * The orchestration the endpoint calls: guards the event's scoring format, reads
 * its confirmed participants, and hands them to generateBracket.
 */
async function generateBracketForEvent(festId, eventId, options = {}) {
  const event = await loadEventOrThrow(festId, eventId);
  if (event.scoringFormat !== EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION) {
    throw new ApplicationError(
      409,
      ERROR_CODES.NOT_A_BRACKET_EVENT,
      "This event does not use a single-elimination bracket.",
      { scoringFormat: event.scoringFormat }
    );
  }

  const { competitorIds, isTeamEvent } = await collectCompetitors(event);
  return generateBracket(String(event._id), competitorIds, { ...options, isTeamEvent, festId });
}

/*
 * The reason is the whole point of the endpoint. Force-regeneration is the one
 * action in the system that can bury a played tournament, so the audit line must
 * say why, in a sentence a stranger reading it next year can act on. Ten
 * characters is not a real sentence, but it is enough to stop a reflexive "ok".
 */
function resolveRegenerationReason(rawReason) {
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length < MINIMUM_REASON_LENGTH || reason.length > MAXIMUM_REASON_LENGTH) {
    throw new ApplicationError(
      400,
      ERROR_CODES.REGENERATION_REASON_REQUIRED,
      `A regeneration reason of ${MINIMUM_REASON_LENGTH}-${MAXIMUM_REASON_LENGTH} characters is required.`,
      { regenerationReason: `must be ${MINIMUM_REASON_LENGTH}-${MAXIMUM_REASON_LENGTH} characters` }
    );
  }
  return reason;
}

/*
 * The administrator override. Archives whatever is there — results and all —
 * and builds a fresh bracket in its place.
 *
 * Certificates are deliberately left alone. A certificate is a frozen snapshot
 * of what a participant was told they achieved; the event happened, and burying
 * the bracket that recorded it does not un-happen it. Revoking them would also
 * mean a participant's phone loses a certificate they may have already shown to
 * somebody. That is a decision for a human with the audit line in front of them,
 * not a cascade.
 */
async function forceRegenerateBracket(festId, eventId, options = {}) {
  const { actorUserId = null, regenerationReason, context = {} } = options;
  const reason = resolveRegenerationReason(regenerationReason);

  const event = await loadEventOrThrow(festId, eventId);
  if (event.scoringFormat !== EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION) {
    throw new ApplicationError(
      409,
      ERROR_CODES.NOT_A_BRACKET_EVENT,
      "This event does not use a single-elimination bracket.",
      { scoringFormat: event.scoringFormat }
    );
  }

  const archivedMatchCount = await supersedeLiveMatches(String(event._id), actorUserId);
  const { competitorIds, isTeamEvent } = await collectCompetitors(event);

  /*
   * The reason is logged before the rebuild, not after. If generation then fails
   * — too few competitors are left to seed, say — the archive has still happened
   * and the record of who did it and why must survive that failure.
   */
  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.BRACKET_FORCE_REGENERATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { regenerationReason: reason, archivedMatchCount },
    ...context,
  });

  return generateBracket(String(event._id), competitorIds, {
    ...options,
    isTeamEvent,
    festId,
    skipRegenerationGuard: true,
  });
}

module.exports = {
  generateBracket,
  generateBracketForEvent,
  forceRegenerateBracket,
  getBracket,
  enterMatchResult,
  setScoresheet,
  collectCompetitors,
  computeBracketShape,
  loadEventOrThrow,
};
