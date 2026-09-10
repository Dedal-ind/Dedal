const { EventScoreModel } = require("../models/event-score-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_SCORING_FORMATS } = require("../constants/event-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const {
  assertMatchVersionOrConflict,
  stampMatchWrite,
} = require("../helpers/match-version-helpers");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

const LEADERBOARD_UNAVAILABLE_MESSAGE =
  "This event uses bracket scoring; use the match system, not the leaderboard.";

function isBracketEvent(event) {
  return event.scoringFormat === EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION;
}

async function loadEventOrThrow(eventId) {
  const event = await EventModel.findById(eventId);
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

/*
 * One score row per confirmed registration, at zero, created only when the admin
 * or coordinator starts scoring — never automatically. Idempotent: an existing row
 * is skipped rather than reset. Refused for bracket events, which score by match.
 */
async function initializeScores(eventId) {
  const event = await loadEventOrThrow(eventId);
  if (isBracketEvent(event)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.LEADERBOARD_NOT_AVAILABLE,
      LEADERBOARD_UNAVAILABLE_MESSAGE
    );
  }

  const registrations = await RegistrationModel.find({
    eventId,
    status: REGISTRATION_STATUSES.CONFIRMED,
  }).lean();

  let createdCount = 0;
  let skippedCount = 0;
  for (const registration of registrations) {
    const existing = await EventScoreModel.findOne({ eventId, registrationId: registration._id });
    if (existing) {
      skippedCount += 1;
      continue;
    }
    await EventScoreModel.create({
      eventId,
      registrationId: registration._id,
      userId: registration.teamId ? null : registration.userId,
      teamId: registration.teamId || null,
      score: 0,
    });
    createdCount += 1;
  }
  return { createdCount, skippedCount };
}

/*
 * A single version-guarded score write, mirroring the match write contract: the
 * version guard runs first, a finalized row is admin-only, and stampMatchWrite
 * bumps the version and records the author before save. The whole change is an
 * append-only audit entry, old score to new.
 */
async function updateScore({
  eventId,
  registrationId,
  newScore,
  expectedVersion,
  actorUserId,
  isAdministrator = false,
  festId = null,
  context = {},
}) {
  const scoreRow = await EventScoreModel.findOne({ eventId, registrationId });
  if (!scoreRow) {
    throw new ApplicationError(404, ERROR_CODES.SCORE_NOT_FOUND, "No score row for this registration.");
  }

  await assertMatchVersionOrConflict(scoreRow, expectedVersion, async () => {
    const current = await EventScoreModel.findById(scoreRow._id);
    return current ? current.toJSON() : null;
  });

  if (scoreRow.isFinalized && !isAdministrator) {
    throw new ApplicationError(
      409,
      ERROR_CODES.MATCH_ALREADY_FINALIZED,
      "This score is finalized and can only be corrected by an administrator."
    );
  }

  const previousScore = scoreRow.score;
  scoreRow.score = newScore;
  await stampMatchWrite(scoreRow, actorUserId).save();

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.SCORE_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT_SCORE,
    entityId: scoreRow._id,
    beforeState: { score: previousScore },
    afterState: { score: newScore, version: scoreRow.version },
    ...context,
  });

  return scoreRow.toJSON();
}

/*
 * Locks every score for the event in one write. Admin only (enforced at the
 * route). After this, an edit needs the admin override, like a finalized match.
 */
async function finalizeScores({ eventId, actorUserId, festId = null, context = {} }) {
  const outcome = await EventScoreModel.updateMany({ eventId }, { $set: { isFinalized: true } });
  const finalizedCount = outcome.modifiedCount || 0;

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.SCORES_FINALIZED,
    entityType: AUDIT_ENTITY_TYPES.EVENT_SCORE,
    entityId: eventId,
    afterState: { finalizedCount },
    ...context,
  });

  return { finalizedCount };
}

/*
 * The public leaderboard. Hidden (isLeaderboardVisible false) or bracket events
 * return an empty array. Otherwise every score for the event, highest first,
 * earlier write breaking ties, with a rank derived from position (never stored).
 */
async function getLeaderboard(eventId) {
  const event = await loadEventOrThrow(eventId);
  if (isBracketEvent(event) || !event.isLeaderboardVisible) {
    return [];
  }

  const scores = await EventScoreModel.find({ eventId })
    .sort({ score: -1, updatedAt: 1 })
    .populate("userId", "fullName participantId")
    .populate("teamId", "teamName")
    .populate({ path: "registrationId", populate: { path: "userId", select: "participantId" } });

  return scores.map((scoreRow, index) => {
    const registrationUser = scoreRow.registrationId && scoreRow.registrationId.userId;
    return {
      rank: index + 1,
      registrationId: scoreRow.registrationId ? String(scoreRow.registrationId._id) : null,
      score: scoreRow.score,
      isFinalized: scoreRow.isFinalized,
      fullName: scoreRow.userId ? scoreRow.userId.fullName : null,
      teamName: scoreRow.teamId ? scoreRow.teamId.teamName : null,
      participantId: registrationUser ? registrationUser.participantId || null : null,
    };
  });
}

/* One score row with its version, for the coordinator's editing UI. */
async function getScoreForRegistration(eventId, registrationId) {
  const scoreRow = await EventScoreModel.findOne({ eventId, registrationId });
  if (!scoreRow) {
    throw new ApplicationError(404, ERROR_CODES.SCORE_NOT_FOUND, "No score row for this registration.");
  }
  return scoreRow.toJSON();
}

module.exports = {
  initializeScores,
  updateScore,
  finalizeScores,
  getLeaderboard,
  getScoreForRegistration,
};
