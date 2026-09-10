const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { AchievementModel } = require("../models/achievement-model");
const { CertificateModel } = require("../models/certificate-model");
const { UserModel } = require("../models/user-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { insertCertificate } = require("../helpers/certificate-insert-helpers");
const { notifyCertificateRelease } = require("../helpers/certificate-release-notify");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const {
  CERTIFICATE_TYPES,
  CERTIFICATE_STATUSES,
} = require("../constants/certificate-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { ACHIEVEMENT_TYPES } = require("../constants/achievement-constants");

/*
 * The results board's two explicit pushes — UI-level convenience routes that
 * COMPOSE the certificate machinery for one event, splitting the old combined
 * "generate + release" into "winners" and "participation". The generic
 * /certificates/generate + /release endpoints stay untouched (the coordinator
 * flow still uses them); these are admin-only and event-scoped.
 *
 * Both are idempotent: insertCertificate returns null on the (userId, festId,
 * eventId) unique index, and the release update only flips pending rows.
 */

const CERTIFICATE_TYPE_BY_PLACEMENT = {
  1: CERTIFICATE_TYPES.WINNER_1ST,
  2: CERTIFICATE_TYPES.WINNER_2ND,
  3: CERTIFICATE_TYPES.WINNER_3RD,
};

const WINNER_CERTIFICATE_TYPES = Object.values(CERTIFICATE_TYPE_BY_PLACEMENT);

const POSITION_BY_PLACEMENT = { 1: "1st", 2: "2nd", 3: "3rd" };

async function loadEventInFestOrThrow(actorUserId, festId, eventId) {
  const { fest } = await assertAdministratorOfFest(actorUserId, festId);
  const event = await EventModel.findOne({ _id: eventId, festId: fest._id }).lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return { fest, event };
}

function formatFestDates(startsOn, endsOn) {
  const options = { day: "numeric", month: "short", year: "numeric" };
  const start = new Date(startsOn).toLocaleDateString("en-IN", options);
  const end = new Date(endsOn).toLocaleDateString("en-IN", options);
  return start === end ? start : `${start} – ${end}`;
}

async function loadUsersById(userIds) {
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("fullName usn collegeId")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

function buildCandidate({ user, fest, event, certificateType, position }) {
  return {
    userId: user._id,
    festId: fest._id,
    eventId: event._id,
    certificateType,
    status: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE,
    generatedAt: new Date(),
    metadata: {
      fullName: user.fullName || null,
      collegeName: user.collegeId?.commonName || null,
      usn: user.usn || null,
      eventName: event.eventName,
      festName: fest.festName,
      festDates: formatFestDates(fest.startsOn, fest.endsOn),
      position: position || null,
      role: null,
    },
  };
}

/* Generate-if-missing, then release the pending rows of the given types. */
async function generateAndRelease({ candidates, event, certificateTypes }) {
  let generatedCount = 0;
  for (const candidate of candidates) {
    if (await insertCertificate(candidate)) {
      generatedCount += 1;
    }
  }
  const releaseFilter = {
    eventId: event._id,
    certificateType: { $in: certificateTypes },
    status: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE,
  };
  /*
   * Captured BEFORE the flip: the notice needs each holder's userId, their
   * certificateType (which chooses the wording) and the metadata snapshot, and
   * after updateMany these rows are unmatchable.
   */
  const rowsToRelease = await CertificateModel.find(releaseFilter)
    .select("userId certificateType metadata")
    .lean();
  const releaseResult = await CertificateModel.updateMany(releaseFilter, {
    $set: { status: CERTIFICATE_STATUSES.RELEASED, releasedAt: new Date() },
  });
  // Fire-and-forget: never blocks or fails the push (see the helper).
  notifyCertificateRelease(rowsToRelease, { festId: event.festId });
  return { generatedCount, releasedCount: releaseResult.modifiedCount };
}

/*
 * Winners: placement comes from the achievements table (eventResult rows are
 * the single source of truth for score-based events; bracket finals also award
 * them). One certificate per (user, fest, event) is a hard unique index, so a
 * winner who already holds a PENDING participation certificate for this event
 * has that row UPGRADED to the winner type rather than silently skipped; a
 * released certificate is never rewritten.
 */
async function pushWinnerCertificates(actorUserId, festId, eventId, context = {}) {
  const { fest, event } = await loadEventInFestOrThrow(actorUserId, festId, eventId);

  const achievements = await AchievementModel.find({
    eventId: event._id,
    achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
    "metadata.placement": { $in: [1, 2, 3] },
  }).lean();
  if (achievements.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.RESULTS_NOT_FINALIZED,
      "No awarded results for this event yet — finalize and award results first."
    );
  }

  const usersById = await loadUsersById(achievements.map((achievement) => achievement.userId));
  const candidates = [];
  let upgradedCount = 0;
  for (const achievement of achievements) {
    const user = usersById.get(String(achievement.userId));
    const certificateType = CERTIFICATE_TYPE_BY_PLACEMENT[achievement.metadata?.placement];
    if (!user || !certificateType) {
      continue;
    }
    const existing = await CertificateModel.findOne({
      userId: achievement.userId,
      festId: fest._id,
      eventId: event._id,
    }).lean();
    if (existing && existing.certificateType === CERTIFICATE_TYPES.PARTICIPATION) {
      if (existing.status === CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE) {
        await CertificateModel.updateOne(
          { _id: existing._id },
          {
            $set: {
              certificateType,
              "metadata.position": POSITION_BY_PLACEMENT[achievement.metadata.placement],
            },
          }
        );
        upgradedCount += 1;
      }
      continue; // released participation rows stay as issued
    }
    candidates.push(
      buildCandidate({
        user,
        fest,
        event,
        certificateType,
        position: POSITION_BY_PLACEMENT[achievement.metadata.placement],
      })
    );
  }

  const { generatedCount, releasedCount } = await generateAndRelease({
    candidates,
    event,
    certificateTypes: WINNER_CERTIFICATE_TYPES,
  });

  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CERTIFICATE_PUSHED_WINNERS,
    entityType: AUDIT_ENTITY_TYPES.CERTIFICATE,
    entityId: event._id,
    afterState: { eventId: String(event._id), generatedCount, releasedCount, upgradedCount },
    ...context,
  });
  return { generatedCount, releasedCount, upgradedCount };
}

/*
 * Participation: every registrant of the event still standing (confirmed,
 * attended, or carrying a bracket progression status). Winner-status rows are
 * excluded here — those people get winner certificates from the other push, and
 * the unique index would collide the two anyway.
 */
const PARTICIPATION_STATUSES = [
  REGISTRATION_STATUSES.CONFIRMED,
  REGISTRATION_STATUSES.ATTENDED,
  REGISTRATION_STATUSES.ELIMINATED,
  REGISTRATION_STATUSES.ADVANCED_TO_R2,
  REGISTRATION_STATUSES.ADVANCED_TO_R3,
  REGISTRATION_STATUSES.ADVANCED_TO_QUARTER_FINAL,
  REGISTRATION_STATUSES.ADVANCED_TO_SEMI_FINAL,
  REGISTRATION_STATUSES.ADVANCED_TO_FINAL,
];

async function pushParticipationCertificates(actorUserId, festId, eventId, context = {}) {
  const { fest, event } = await loadEventInFestOrThrow(actorUserId, festId, eventId);

  const registrations = await RegistrationModel.find({
    eventId: event._id,
    status: { $in: PARTICIPATION_STATUSES },
  })
    .select("userId")
    .lean();

  const usersById = await loadUsersById(registrations.map((registration) => registration.userId));
  const candidates = [];
  for (const registration of registrations) {
    const user = usersById.get(String(registration.userId));
    if (!user) {
      continue;
    }
    candidates.push(
      buildCandidate({ user, fest, event, certificateType: CERTIFICATE_TYPES.PARTICIPATION })
    );
  }

  const { generatedCount, releasedCount } = await generateAndRelease({
    candidates,
    event,
    certificateTypes: [CERTIFICATE_TYPES.PARTICIPATION],
  });

  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CERTIFICATE_PUSHED_PARTICIPATION,
    entityType: AUDIT_ENTITY_TYPES.CERTIFICATE,
    entityId: event._id,
    afterState: { eventId: String(event._id), generatedCount, releasedCount },
    ...context,
  });
  return { generatedCount, releasedCount };
}

module.exports = { pushWinnerCertificates, pushParticipationCertificates };
