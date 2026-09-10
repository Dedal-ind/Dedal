const mongoose = require("mongoose");

const { AchievementModel } = require("../models/achievement-model");
const {
  SelfDeclaredAchievementModel,
} = require("../models/self-declared-achievement-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { MatchModel } = require("../models/match-model");
const { EventScoreModel } = require("../models/event-score-model");
const { CertificateModel } = require("../models/certificate-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_SCORING_FORMATS } = require("../constants/event-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { MATCH_STATUSES } = require("../constants/match-constants");
const { CERTIFICATE_STATUSES } = require("../constants/certificate-constants");
const {
  ACHIEVEMENT_TYPES,
  ACHIEVEMENT_SOURCES,
  ACHIEVEMENT_RESPONSE_SOURCES,
  SELF_DECLARED_TITLE_MAX_LENGTH,
  SELF_DECLARED_DESCRIPTION_MAX_LENGTH,
  BADGE_CATALOG,
} = require("../constants/achievement-constants");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const PLACEMENT_LABELS = { 1: "1st Place", 2: "2nd Place", 3: "3rd Place" };

/* ------------------------------------------------------------------ helpers */

/*
 * A competitor is either a solo user or a team. Placements are recorded per user,
 * so a team competitor expands to its whole roster: every member earns the row.
 */
async function resolveAwardeeUserIds(competitor) {
  if (competitor.userId) {
    return [competitor.userId];
  }
  if (competitor.teamId) {
    const team = await TeamModel.findById(competitor.teamId).select("memberUserIds").lean();
    return team ? team.memberUserIds : [];
  }
  return [];
}

function isSameCompetitor(side, winner) {
  if (winner.userId && side.userId) {
    return String(side.userId) === String(winner.userId);
  }
  if (winner.teamId && side.teamId) {
    return String(side.teamId) === String(winner.teamId);
  }
  return false;
}

/*
 * One eventResult row, idempotent on (userId, eventId, placement). The pre-check
 * skips the common case; the E11000 catch closes the concurrent-award race the
 * partial unique index guards. Returns true when a row was actually created.
 */
async function createEventResultAward({ userId, event, placement, actorUserId, context }) {
  const existing = await AchievementModel.findOne({
    userId,
    eventId: event._id,
    achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
    "metadata.placement": placement,
  }).lean();
  if (existing) {
    return false;
  }

  const label = PLACEMENT_LABELS[placement] || `Placement ${placement}`;
  let created;
  try {
    created = await AchievementModel.create({
      userId,
      achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
      title: `${label} — ${event.eventName}`,
      description: null,
      festId: event.festId,
      eventId: event._id,
      metadata: { placement, eventName: event.eventName },
      source: ACHIEVEMENT_SOURCES.SYSTEM,
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      return false;
    }
    throw error;
  }

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ACHIEVEMENT_EVENT_RESULT_AWARDED,
    entityType: AUDIT_ENTITY_TYPES.ACHIEVEMENT,
    entityId: created._id,
    afterState: { userId: String(userId), eventId: String(event._id), placement },
    ...context,
  });
  return true;
}

/*
 * The final round's placements from a finalized bracket: the winner is 1st, the
 * other side of the final is the runner-up (2nd). Returns [{competitor, placement}].
 */
async function readBracketPlacements(eventId) {
  const deepest = await MatchModel.findOne({
    eventId,
    status: { $ne: MATCH_STATUSES.SUPERSEDED_BY_REGENERATION },
  })
    .sort({ roundNumber: -1 })
    .select("roundNumber")
    .lean();
  if (!deepest) {
    return null;
  }

  const finalMatch = await MatchModel.findOne({
    eventId,
    roundNumber: deepest.roundNumber,
    status: { $ne: MATCH_STATUSES.SUPERSEDED_BY_REGENERATION },
    isFinalized: true,
  }).lean();
  if (!finalMatch) {
    return null;
  }

  const winner = { userId: finalMatch.winnerUserId, teamId: finalMatch.winnerTeamId };
  const sideA = { userId: finalMatch.participantAUserId, teamId: finalMatch.participantATeamId };
  const sideB = { userId: finalMatch.participantBUserId, teamId: finalMatch.participantBTeamId };
  const runnerUp = isSameCompetitor(sideA, winner) ? sideB : sideA;

  const placements = [{ competitor: winner, placement: 1 }];
  if (runnerUp.userId || runnerUp.teamId) {
    placements.push({ competitor: runnerUp, placement: 2 });
  }
  return placements;
}

/*
 * The top three of a finalized leaderboard, highest score first, earlier write
 * breaking a tie — the same ordering the public leaderboard uses. Returns null
 * when no score for the event is finalized yet.
 */
async function readScorePlacements(eventId) {
  const finalized = await EventScoreModel.find({ eventId, isFinalized: true })
    .sort({ score: -1, updatedAt: 1 })
    .lean();
  if (finalized.length === 0) {
    return null;
  }
  return finalized.slice(0, 3).map((row, index) => ({
    competitor: { userId: row.userId, teamId: row.teamId },
    placement: index + 1,
  }));
}

/* ------------------------------------------------------ 1. award event results */

/*
 * Awards eventResult achievements from an event's finalized results. A bracket
 * event yields the winner (1st) and runner-up (2nd) of its final; a score-based
 * event yields the top three of its finalized leaderboard. Idempotent per
 * (user, event, placement), so a re-run adds nothing. Refused with
 * RESULTS_NOT_FINALIZED when neither a bracket final nor any score is finalized.
 */
async function awardEventResults(eventId, actorUserId, context = {}) {
  const event = await EventModel.findById(eventId);
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const isBracket = event.scoringFormat === EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION;
  const placements = isBracket
    ? await readBracketPlacements(eventId)
    : await readScorePlacements(eventId);

  if (!placements) {
    throw new ApplicationError(
      409,
      ERROR_CODES.RESULTS_NOT_FINALIZED,
      "This event has no finalized results to award yet."
    );
  }

  let awardedCount = 0;
  for (const { competitor, placement } of placements) {
    const userIds = await resolveAwardeeUserIds(competitor);
    for (const userId of userIds) {
      const created = await createEventResultAward({
        userId,
        event,
        placement,
        actorUserId,
        context,
      });
      if (created) {
        awardedCount += 1;
      }
    }
  }
  return { awardedCount };
}

/* ------------------------------------------------------------- 2. award badges */

/*
 * One criteria checker per badge id, evaluated against live data. Adding a badge
 * to the catalog means adding an entry here — the award loop below never changes.
 */
const BADGE_CRITERIA_CHECKERS = {
  async firstFest(userId) {
    const one = await RegistrationModel.exists({
      userId,
      status: REGISTRATION_STATUSES.CONFIRMED,
    });
    return Boolean(one);
  },
  async fiveEvents(userId) {
    const eventIds = await RegistrationModel.distinct("eventId", {
      userId,
      status: REGISTRATION_STATUSES.CONFIRMED,
    });
    return eventIds.length >= 5;
  },
  async allRounder(userId) {
    const eventIds = await RegistrationModel.distinct("eventId", {
      userId,
      status: REGISTRATION_STATUSES.CONFIRMED,
    });
    if (eventIds.length === 0) {
      return false;
    }
    const categories = await EventModel.distinct("category", {
      _id: { $in: eventIds },
      category: { $ne: null },
    });
    return categories.length >= 3;
  },
  async teamCaptain(userId) {
    const one = await TeamModel.exists({ leaderUserId: userId });
    return Boolean(one);
  },
};

/*
 * Grants any badge the user has newly earned. Iterates the catalog, skips the
 * ones already held, evaluates the rest, and returns the titles of the badges
 * awarded this run (empty when nothing new). Called fire-and-forget after every
 * registration confirmation — see awardBadgesInBackground — so it must be cheap
 * and must never assume it is the only caller for this user.
 */
async function awardBadges(userId, actorUserId = userId, context = {}) {
  const newlyAwarded = [];

  for (const badge of Object.values(BADGE_CATALOG)) {
    const already = await AchievementModel.findOne({
      userId,
      achievementType: ACHIEVEMENT_TYPES.BADGE,
      "metadata.badgeId": badge.id,
    }).lean();
    if (already) {
      continue;
    }

    const checker = BADGE_CRITERIA_CHECKERS[badge.id];
    if (!checker || !(await checker(userId))) {
      continue;
    }

    let created;
    try {
      created = await AchievementModel.create({
        userId,
        achievementType: ACHIEVEMENT_TYPES.BADGE,
        title: badge.title,
        description: badge.description,
        metadata: { badgeId: badge.id, criteria: badge.criteria },
        source: ACHIEVEMENT_SOURCES.SYSTEM,
      });
    } catch (error) {
      // A concurrent award won the unique index first; the badge is held, nothing to do.
      if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
        continue;
      }
      throw error;
    }

    newlyAwarded.push(badge.title);
    await recordAuditLog({
      actorUserId,
      action: AUDIT_ACTIONS.ACHIEVEMENT_BADGE_AWARDED,
      entityType: AUDIT_ENTITY_TYPES.ACHIEVEMENT,
      entityId: created._id,
      afterState: { userId: String(userId), badgeId: badge.id },
      ...context,
    });
  }

  return newlyAwarded;
}

/*
 * The fire-and-forget wrapper the registration paths call. Awards run without
 * blocking the response and a failure is logged, never thrown — a badge that
 * could not be granted must not fail the registration that earned it.
 */
function awardBadgesInBackground(userId) {
  return Promise.resolve()
    .then(() => awardBadges(userId))
    .catch((error) => {
      console.error(`Badge award failed for user ${userId}: ${error.message}`);
    });
}

/* --------------------------------------------------- 3. sync certificates */

/*
 * Mirrors a user's released certificates into certificate-type achievements, one
 * per certificate, keyed on certificateId so a re-run adds nothing. Lazy: called
 * when the achievements profile is read, not on a schedule.
 */
async function syncCertificateAchievements(userId) {
  const certificates = await CertificateModel.find({
    userId,
    status: CERTIFICATE_STATUSES.RELEASED,
  }).lean();

  for (const certificate of certificates) {
    const existing = await AchievementModel.findOne({
      userId,
      certificateId: certificate._id,
    }).lean();
    if (existing) {
      continue;
    }

    const eventName = certificate.metadata?.eventName || certificate.metadata?.festName || "Certificate";
    try {
      await AchievementModel.create({
        userId,
        achievementType: ACHIEVEMENT_TYPES.CERTIFICATE,
        title: eventName,
        description: `Verification code: ${certificate.verificationCode}`,
        festId: certificate.festId,
        eventId: certificate.eventId,
        certificateId: certificate._id,
        metadata: { verificationCode: certificate.verificationCode },
        awardedAt: certificate.releasedAt || certificate.generatedAt,
        source: ACHIEVEMENT_SOURCES.CERTIFICATE,
      });
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
        throw error;
      }
    }
  }
}

/* ----------------------------------------------------- 4. get my achievements */

function serializeSystemAchievement(row) {
  const fest = row.festId && typeof row.festId === "object" ? row.festId : null;
  const event = row.eventId && typeof row.eventId === "object" ? row.eventId : null;
  return {
    id: String(row._id),
    achievementType: row.achievementType,
    title: row.title,
    description: row.description || null,
    festName: fest ? fest.festName : null,
    eventName: event ? event.eventName : null,
    date: row.awardedAt,
    source: row.source,
    isVerified: true,
  };
}

function serializeSelfDeclared(row) {
  return {
    id: String(row._id),
    achievementType: "selfDeclared",
    title: row.title,
    description: row.description || null,
    festName: null,
    eventName: null,
    date: row.achievedAt || row.createdAt,
    source: ACHIEVEMENT_RESPONSE_SOURCES.SELF_DECLARED,
    isVerified: false,
  };
}

/*
 * The unified achievements profile: system + certificate rows from the Achievement
 * collection, plus the user's self-declared rows, merged into one date-descending
 * list. The owner sees every self-declared row; anyone else sees only the visible
 * ones. Certificates are lazily synced first, so a just-released certificate shows
 * up on the next profile view without a background job.
 */
async function getMyAchievements(userId, { isOwner }) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid user id.");
  }

  await syncCertificateAchievements(userId);

  const systemRows = await AchievementModel.find({ userId })
    .populate({ path: "festId", select: "festName" })
    .populate({ path: "eventId", select: "eventName" })
    .lean();

  const selfDeclaredFilter = { userId };
  if (!isOwner) {
    selfDeclaredFilter.isVisible = true;
  }
  const selfDeclaredRows = await SelfDeclaredAchievementModel.find(selfDeclaredFilter).lean();

  const merged = [
    ...systemRows.map(serializeSystemAchievement),
    ...selfDeclaredRows.map(serializeSelfDeclared),
  ];

  merged.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  return merged;
}

/* ------------------------------------------------- 5. add self-declared */

function validateSelfDeclaredInput(title, description) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) {
    throw new ApplicationError(400, ERROR_CODES.ACHIEVEMENT_INVALID, "A title is required.");
  }
  if (trimmedTitle.length > SELF_DECLARED_TITLE_MAX_LENGTH) {
    throw new ApplicationError(
      400,
      ERROR_CODES.ACHIEVEMENT_INVALID,
      `Title must be at most ${SELF_DECLARED_TITLE_MAX_LENGTH} characters.`
    );
  }
  if (
    typeof description === "string" &&
    description.length > SELF_DECLARED_DESCRIPTION_MAX_LENGTH
  ) {
    throw new ApplicationError(
      400,
      ERROR_CODES.ACHIEVEMENT_INVALID,
      `Description must be at most ${SELF_DECLARED_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  return trimmedTitle;
}

async function addSelfDeclaredAchievement(userId, { title, description, achievedAt }) {
  const trimmedTitle = validateSelfDeclaredInput(title, description);
  const row = await SelfDeclaredAchievementModel.create({
    userId,
    title: trimmedTitle,
    description: description || null,
    achievedAt: achievedAt || null,
  });
  return row.toJSON();
}

/* --------------------------------------- 6. update / delete self-declared */

async function loadOwnedSelfDeclaredOrThrow(userId, achievementId) {
  const row = mongoose.Types.ObjectId.isValid(achievementId)
    ? await SelfDeclaredAchievementModel.findOne({ _id: achievementId, userId })
    : null;
  if (!row) {
    throw new ApplicationError(404, ERROR_CODES.ACHIEVEMENT_NOT_FOUND, "Achievement not found.");
  }
  return row;
}

async function updateSelfDeclaredAchievement(userId, achievementId, updates = {}) {
  const row = await loadOwnedSelfDeclaredOrThrow(userId, achievementId);

  if (updates.title !== undefined || updates.description !== undefined) {
    const nextTitle = updates.title !== undefined ? updates.title : row.title;
    const nextDescription =
      updates.description !== undefined ? updates.description : row.description;
    const trimmedTitle = validateSelfDeclaredInput(nextTitle, nextDescription);
    if (updates.title !== undefined) {
      row.title = trimmedTitle;
    }
    if (updates.description !== undefined) {
      row.description = updates.description || null;
    }
  }
  if (updates.achievedAt !== undefined) {
    row.achievedAt = updates.achievedAt || null;
  }
  if (updates.isVisible !== undefined) {
    row.isVisible = Boolean(updates.isVisible);
  }

  await row.save();
  return row.toJSON();
}

async function deleteSelfDeclaredAchievement(userId, achievementId) {
  const outcome = await SelfDeclaredAchievementModel.deleteOne({ _id: achievementId, userId });
  if (outcome.deletedCount === 0) {
    throw new ApplicationError(404, ERROR_CODES.ACHIEVEMENT_NOT_FOUND, "Achievement not found.");
  }
  return { deleted: true };
}

module.exports = {
  awardEventResults,
  awardBadges,
  awardBadgesInBackground,
  syncCertificateAchievements,
  getMyAchievements,
  addSelfDeclaredAchievement,
  updateSelfDeclaredAchievement,
  deleteSelfDeclaredAchievement,
};
