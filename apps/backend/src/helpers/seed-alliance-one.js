/*
 * Development seed for the Alliance ONE 2026 fest. Wipes every collection's
 * documents (indexes preserved) and rebuilds a complete fest: the host college,
 * the staff and participant users, the full hierarchical event tree, staff
 * assignments, checkpoints, and a slice of sample registrations, scores and
 * achievements — enough to exercise the hierarchy, payment, scoring, staff
 * directory and achievements features end to end.
 *
 * Idempotent by construction: it resets first, then seeds, so re-running lands
 * the same clean state. Hard-gated to APPLICATION_ENVIRONMENT=development.
 *
 * Consumer-only: this file drives the existing services and models exactly as an
 * API caller would. It does not modify any service, model, route or helper.
 *
 * Two deliberate accommodations to the live services (see the answered design
 * question in the seed's history):
 *   1. Event dates are anchored to "now" so the fest is CURRENTLY LIVE: the fest
 *      spans two days ago through five days from now, every leaf's registration
 *      window is open right now, and event start times are split between an
 *      early wave (1-3 days out) and a late wave (4-5 days out) — so the
 *      time-gated registration/scan services accept the data and paid flows can
 *      be exercised end to end.
 *   2. The five solo events that receive sample registrations are seeded FREE,
 *      because the solo-registration service derives paid/free from the event and
 *      has no fee override — free is the only way to create passes/entitlements
 *      without a payment flow. Every other event keeps its real fee.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");

const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { ScanModel } = require("../models/scan-model");
const { CertificateModel } = require("../models/certificate-model");
const { AuditLogModel } = require("../models/audit-log-model");
const { OtpCodeModel } = require("../models/otp-code-model");
const { SignInLogModel } = require("../models/sign-in-log-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const {
  PromotionModel,
  PROMOTION_STATUSES,
  PROMOTION_TYPES,
} = require("../models/promotion-model");
const { MatchModel } = require("../models/match-model");
const { EventScoreModel } = require("../models/event-score-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { AchievementModel } = require("../models/achievement-model");
const { SelfDeclaredAchievementModel } = require("../models/self-declared-achievement-model");

const { generateParticipantId } = require("./participant-id-helpers");
const { generateFestSlug } = require("./generate-fest-slug");
const { insertFestWithUniqueSlug } = require("./insert-fest-with-unique-slug");
const { insertEventWithUniqueSlug } = require("./insert-event-with-unique-slug");

const { registerParticipantSolo } = require("../services/registration-service");
const {
  initializeScores,
  updateScore,
  finalizeScores,
  getScoreForRegistration,
} = require("../services/score-service");
const {
  awardEventResults,
  awardBadges,
  addSelfDeclaredAchievement,
} = require("../services/achievement-service");

const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const {
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  FEE_TYPES,
} = require("../constants/event-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { CHECKPOINT_TYPES, CHECKPOINT_DIRECTION_MODES } = require("../constants/scan-constants");
const { SHIFT_STATUSES } = require("../constants/shift-constants");

const {
  FREE_REGISTRATION_TARGETS,
  COLLEGES,
  PLATFORM_ADMIN,
  COLLEGE_ADMIN,
  COORDINATORS,
  VOLUNTEERS,
  PARTICIPANTS,
  REGISTRATION_PLAN,
  SELF_DECLARED_ACHIEVEMENTS,
  EVENT_TREE,
} = require("./seed-alliance-one-data");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const VENUE = "Alliance University, Bengaluru";

// Every collection this seed owns. Documents are deleted (indexes kept), never
// dropped — unlike reset-database.js, which drops whole collections.
const ALL_MODELS = [
  UserModel, CollegeModel, FestModel, EventModel, RegistrationModel, TeamModel,
  PassModel, EntitlementModel, StaffAssignmentModel, VolunteerShiftModel, ScanModel,
  CertificateModel, AuditLogModel, OtpCodeModel, SignInLogModel, CheckpointModel,
  MatchModel, EventScoreModel, PaymentOrderModel, AchievementModel,
  SelfDeclaredAchievementModel, PromotionModel,
];

function utcMidnightDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function utcEndOfDayDaysFromNow(days) {
  const date = utcMidnightDaysFromNow(days);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function emailFromName(fullName, domain) {
  const local = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");
  return `${local}@${domain}`;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/*
 * Builds a schedule that keeps the fest CURRENTLY LIVE. Every registration
 * window opened seven days ago and closes two days from now (clamped to the
 * event's start, which the model requires). Leaves alternate between an early
 * wave starting 1-3 days out and a late wave starting 4-5 days out, so the
 * catalogue shows a mix of upcoming events; each keeps its real Alliance ONE
 * duration (endDay - startDay), clamped to the fest's last day. Containers span
 * from the earliest leaf day through the fest's last day so the drill-down
 * window encloses every child.
 */
function eventSchedule(fest, { isContainer, spanDays, leafIndex }, now) {
  const registrationOpensAt = new Date(now.getTime() - 7 * DAY_MS);
  const lastFestDay = 5;

  let startsAt;
  let endsAt;
  if (isContainer) {
    startsAt = new Date(utcMidnightDaysFromNow(1).getTime() + 10 * HOUR_MS);
    endsAt = new Date(utcMidnightDaysFromNow(lastFestDay).getTime() + 17 * HOUR_MS);
  } else {
    const wave = Math.floor(leafIndex / 2);
    const startOffsetDays = leafIndex % 2 === 0 ? 1 + (wave % 3) : 4 + (wave % 2);
    const endOffsetDays = Math.min(startOffsetDays + spanDays, lastFestDay);
    startsAt = new Date(utcMidnightDaysFromNow(startOffsetDays).getTime() + 10 * HOUR_MS);
    const dayEnd = new Date(utcMidnightDaysFromNow(endOffsetDays).getTime() + 17 * HOUR_MS);
    endsAt = new Date(Math.max(dayEnd.getTime(), startsAt.getTime() + 3 * HOUR_MS));
  }

  return {
    startsAt,
    endsAt,
    registrationOpensAt,
    registrationClosesAt: new Date(Math.min(now.getTime() + 2 * DAY_MS, startsAt.getTime())),
  };
}

/*
 * Clears documents via the native driver collection rather than Model.deleteMany:
 * it keeps indexes intact (unlike dropping the collection) AND bypasses model
 * middleware — StaffAssignmentModel deliberately blocks deleteMany to preserve
 * history, but a full dev reset legitimately wipes it. deleteMany on a
 * not-yet-created collection is a harmless no-op.
 */
async function resetDatabase() {
  const results = await Promise.all(ALL_MODELS.map((model) => model.collection.deleteMany({})));
  const total = results.reduce((sum, r) => sum + r.deletedCount, 0);
  console.log(`Reset: cleared ${total} document(s) across ${ALL_MODELS.length} collections.`);
}

async function seedColleges() {
  const byKey = {};
  for (const college of COLLEGES) {
    byKey[college.key] = await CollegeModel.create({
      collegeName: college.collegeName,
      commonName: college.commonName,
      aisheCode: college.aisheCode,
      city: college.city,
      state: college.state,
      isVerified: college.isVerified,
    });
  }
  console.log(`Seeded ${COLLEGES.length} colleges.`);
  return byKey;
}

// A profile-complete user. Profile completeness is set directly rather than
// recomputed, so a coordinator or admin without a USN still counts as complete.
async function createUser({ emailAddress, fullName, phoneNumber, collegeId = null }) {
  const now = new Date();
  return UserModel.create({
    emailAddress,
    fullName,
    phoneNumber,
    collegeId,
    participantId: generateParticipantId(fullName, phoneNumber),
    isProfileComplete: true,
    emailVerifiedAt: now,
    signedUpAt: now,
  });
}

async function seedUsers(colleges) {
  const allianceId = colleges.alliance._id;

  const platformAdmin = await createUser({ ...PLATFORM_ADMIN });
  await StaffAssignmentModel.create({
    userId: platformAdmin._id,
    collegeId: null,
    festId: null,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    validFrom: new Date(Date.now() - DAY_MS),
    assignedByUserId: platformAdmin._id,
  });

  const collegeAdmin = await createUser({
    emailAddress: COLLEGE_ADMIN.emailAddress,
    fullName: COLLEGE_ADMIN.fullName,
    phoneNumber: COLLEGE_ADMIN.phoneNumber,
    collegeId: allianceId,
  });
  await StaffAssignmentModel.create({
    userId: collegeAdmin._id,
    collegeId: allianceId,
    festId: null,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    validFrom: new Date(Date.now() - DAY_MS),
    assignedByUserId: platformAdmin._id,
  });

  const coordinators = [];
  for (const coordinator of COORDINATORS) {
    const user = await createUser({
      emailAddress: emailFromName(coordinator.fullName, "alliance.edu.in"),
      fullName: coordinator.fullName,
      phoneNumber: coordinator.phoneNumber,
      collegeId: allianceId,
    });
    coordinators.push({ user, parentKey: coordinator.parentKey });
  }

  const volunteers = [];
  for (const volunteer of VOLUNTEERS) {
    const user = await createUser({
      emailAddress: emailFromName(volunteer.fullName, "alliance.edu.in"),
      fullName: volunteer.fullName,
      phoneNumber: volunteer.phoneNumber,
      collegeId: allianceId,
    });
    volunteers.push({ user, eventKeys: volunteer.eventKeys, allowedCheckpointTypes: volunteer.allowedCheckpointTypes });
  }

  const participantsByPhone = {};
  for (const participant of PARTICIPANTS) {
    participantsByPhone[participant.phoneNumber] = await createUser({
      emailAddress: emailFromName(participant.fullName, "example.com"),
      fullName: participant.fullName,
      phoneNumber: participant.phoneNumber,
      collegeId: colleges[participant.collegeKey]._id,
    });
  }

  console.log(
    `Seeded users: 1 platform admin, 1 college admin, ${coordinators.length} coordinators, ` +
      `${volunteers.length} volunteers, ${PARTICIPANTS.length} participants.`
  );
  return { platformAdmin, collegeAdmin, coordinators, volunteers, participantsByPhone };
}

async function seedFest(colleges, collegeAdmin) {
  const attributes = {
    festName: "Alliance ONE 2026",
    hostCollegeId: colleges.alliance._id,
    // A stable placeholder banner so the Discover cards exercise the real
    // image path in dev; offline, the frontend falls back to its placeholder.
    bannerImageUrl: "https://picsum.photos/seed/alliance-one/1200/600",
    description: "Alliance University's flagship inter-college fest across nine schools.",
    // Two days in, five to go: the fest is live right now.
    startsOn: utcMidnightDaysFromNow(-2),
    endsOn: utcEndOfDayDaysFromNow(5),
    visibility: FEST_VISIBILITIES.PUBLIC,
    allowedCollegeIds: [],
    contactEmail: collegeAdmin.emailAddress,
    status: FEST_STATUSES.PUBLISHED,
    createdByUserId: collegeAdmin._id,
    offers: [
      {
        offerName: "Food",
        offerKey: "food",
        isActive: true,
        isPaid: false,
        ratePaise: 0,
        collectsNumberOfPeople: true,
      },
      {
        offerName: "Accommodation",
        offerKey: "accommodation",
        isActive: true,
        isPaid: false,
        ratePaise: 0,
      },
    ],
  };
  const fest = await insertFestWithUniqueSlug(attributes, generateFestSlug(attributes.festName));
  console.log(`Seeded fest ${fest.festName} (${fest.festSlug}).`);
  return fest;
}

// Walks the tree parents-first, so a child always finds its parent's ObjectId.
async function seedEvents(fest, collegeAdmin) {
  const now = new Date();
  const byKey = {};
  let leafCount = 0;

  for (const node of EVENT_TREE) {
    const parentEventId = node.parent ? byKey[node.parent]._id : null;
    const isContainer = Boolean(node.container);
    const isFreeTarget = FREE_REGISTRATION_TARGETS.has(node.key);

    const isTeam = !isContainer && node.type === EVENT_TYPES.TEAM;
    const schedule = eventSchedule(
      fest,
      {
        isContainer,
        spanDays: isContainer ? 0 : node.endDay - node.startDay,
        leafIndex: leafCount,
      },
      now
    );

    const attributes = {
      festId: fest._id,
      parentEventId,
      eventName: node.name,
      description: isContainer
        ? `${node.name} — a grouping of Alliance ONE 2026 events.`
        : `${node.name}, part of Alliance ONE 2026.`,
      category: isContainer ? null : node.category,
      eventType: isTeam ? EVENT_TYPES.TEAM : EVENT_TYPES.SOLO,
      minimumTeamSize: isTeam ? node.min : 1,
      maximumTeamSize: isTeam ? node.max : 1,
      scoringFormat: node.scoringFormat || EVENT_SCORING_FORMATS.NONE,
      venue: VENUE,
      capacity: isContainer ? null : node.capacity,
      feeType: isContainer || isFreeTarget ? FEE_TYPES.FREE : node.feeType,
      feeAmountPaise: isContainer || isFreeTarget ? 0 : node.feePaise,
      isLeaderboardVisible: node.scoringFormat === EVENT_SCORING_FORMATS.SCORE_BASED,
      status: EVENT_STATUSES.PUBLISHED,
      createdByUserId: collegeAdmin._id,
      ...schedule,
    };

    byKey[node.key] = await insertEventWithUniqueSlug(attributes, slugify(node.name));
    if (!isContainer) {
      leafCount += 1;
    }
  }

  const containerCount = EVENT_TREE.length - leafCount;
  console.log(`Seeded ${EVENT_TREE.length} events (${containerCount} containers, ${leafCount} leaves).`);
  return byKey;
}

async function seedStaffAssignments(fest, colleges, users, eventsByKey) {
  const assignedByUserId = users.collegeAdmin._id;
  const validFrom = new Date(Date.now() - DAY_MS);
  const base = {
    collegeId: colleges.alliance._id,
    festId: fest._id,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    validFrom,
    assignedByUserId,
  };

  for (const { user, parentKey } of users.coordinators) {
    await StaffAssignmentModel.create({
      ...base,
      userId: user._id,
      role: STAFF_ROLES.COORDINATOR,
      eventIds: [eventsByKey[parentKey]._id],
      allowedCheckpointTypes: [],
    });
  }

  for (const { user, eventKeys, allowedCheckpointTypes } of users.volunteers) {
    await StaffAssignmentModel.create({
      ...base,
      userId: user._id,
      role: STAFF_ROLES.VOLUNTEER,
      eventIds: eventKeys.map((key) => eventsByKey[key]._id),
      allowedCheckpointTypes,
    });
  }

  console.log(
    `Seeded staff assignments: ${users.coordinators.length} coordinators, ${users.volunteers.length} volunteers.`
  );
}

async function seedCheckpoints(fest, eventsByKey) {
  const eventEntryByKey = {};
  const leaves = EVENT_TREE.filter((node) => !node.container);
  for (const node of leaves) {
    eventEntryByKey[node.key] = await CheckpointModel.create({
      festId: fest._id,
      eventId: eventsByKey[node.key]._id,
      checkpointName: `${node.name} Entry`,
      checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
      directionMode: CHECKPOINT_DIRECTION_MODES.IN_ONLY,
    });
  }

  const festLevel = [
    { name: "Main Gate", type: CHECKPOINT_TYPES.GATE, direction: CHECKPOINT_DIRECTION_MODES.IN_AND_OUT },
    { name: "South Gate", type: CHECKPOINT_TYPES.GATE, direction: CHECKPOINT_DIRECTION_MODES.IN_AND_OUT },
    { name: "East Gate", type: CHECKPOINT_TYPES.GATE, direction: CHECKPOINT_DIRECTION_MODES.IN_AND_OUT },
    { name: "Food Court A", type: CHECKPOINT_TYPES.FOOD_COUNTER, direction: CHECKPOINT_DIRECTION_MODES.IN_ONLY },
    { name: "Food Court B", type: CHECKPOINT_TYPES.FOOD_COUNTER, direction: CHECKPOINT_DIRECTION_MODES.IN_ONLY },
    { name: "Hostel Check-in", type: CHECKPOINT_TYPES.ACCOMMODATION, direction: CHECKPOINT_DIRECTION_MODES.IN_ONLY },
  ];
  const festLevelByType = {};
  for (const checkpoint of festLevel) {
    const created = await CheckpointModel.create({
      festId: fest._id,
      eventId: null,
      checkpointName: checkpoint.name,
      checkpointType: checkpoint.type,
      directionMode: checkpoint.direction,
    });
    (festLevelByType[checkpoint.type] ??= []).push(created);
  }

  // The new offer-driven counters: one OFFER checkpoint per active fest offer
  // (Food, Accommodation), exactly what publishFest would materialise.
  const { ensureOfferCheckpoints } = require("./checkpoint-helpers");
  await ensureOfferCheckpoints(fest);

  console.log(
    `Seeded checkpoints: ${leaves.length} event-entry + ${festLevel.length} fest-level (3 gate, 2 food, 1 accommodation) + ${(fest.offers ?? []).length} offer counters.`
  );
  return { eventEntryByKey, festLevelByType };
}

/*
 * A shift is the precise unit the scanner authorizes against once a volunteer has
 * any shift in the fest — a coarse staff assignment alone is not enough. Each
 * seeded volunteer gets one shift ACTIVE NOW (so scanning works the moment the seed
 * finishes) at a checkpoint whose type they are allowed to work, plus one upcoming
 * shift so the roster shows a schedule rather than a single row. The checkpoint is
 * chosen to respect the volunteer's allowedCheckpointTypes (empty = unrestricted).
 */
function pickShiftCheckpoint(volunteer, checkpoints) {
  const types = volunteer.allowedCheckpointTypes;
  const allows = (type) => types.length === 0 || types.includes(type);
  const festLevel = checkpoints.festLevelByType;

  if (allows(CHECKPOINT_TYPES.FOOD_COUNTER) && !allows(CHECKPOINT_TYPES.GATE) && festLevel[CHECKPOINT_TYPES.FOOD_COUNTER]) {
    // A food-only volunteer works a food counter.
    return festLevel[CHECKPOINT_TYPES.FOOD_COUNTER][0];
  }
  if (allows(CHECKPOINT_TYPES.GATE) && festLevel[CHECKPOINT_TYPES.GATE]) {
    // Gate/entry volunteers cover a gate — the busiest scanning point.
    return festLevel[CHECKPOINT_TYPES.GATE][0];
  }
  // Unrestricted volunteers cover their own event's entry checkpoint when they have
  // one, else fall back to accommodation, else any fest-level checkpoint.
  const ownEventEntry = volunteer.eventKeys
    .map((key) => checkpoints.eventEntryByKey[key])
    .find(Boolean);
  if (ownEventEntry) {
    return ownEventEntry;
  }
  if (festLevel[CHECKPOINT_TYPES.ACCOMMODATION]) {
    return festLevel[CHECKPOINT_TYPES.ACCOMMODATION][0];
  }
  return Object.values(festLevel)[0][0];
}

async function seedVolunteerShifts(fest, users, checkpoints) {
  const assignedByUserId = users.collegeAdmin._id;
  const now = Date.now();
  let shiftCount = 0;

  for (const volunteer of users.volunteers) {
    const checkpoint = pickShiftCheckpoint(volunteer, checkpoints);

    // Active NOW: opened an hour ago, runs seven more — comfortably spans the
    // moment the seed finishes, so a scan authorizes immediately.
    await VolunteerShiftModel.create({
      festId: fest._id,
      userId: volunteer.user._id,
      checkpointId: checkpoint._id,
      startsAt: new Date(now - HOUR_MS),
      endsAt: new Date(now + 7 * HOUR_MS),
      status: SHIFT_STATUSES.SCHEDULED,
      assignedByUserId,
    });

    // An upcoming shift tomorrow, so the roster reads as a schedule.
    await VolunteerShiftModel.create({
      festId: fest._id,
      userId: volunteer.user._id,
      checkpointId: checkpoint._id,
      startsAt: new Date(now + DAY_MS),
      endsAt: new Date(now + DAY_MS + 8 * HOUR_MS),
      status: SHIFT_STATUSES.SCHEDULED,
      assignedByUserId,
    });

    shiftCount += 2;
  }

  console.log(
    `Seeded ${shiftCount} volunteer shifts (${users.volunteers.length} active now + ${users.volunteers.length} upcoming).`
  );
}

/*
 * Home-screen promotion banners, both types, PUBLISHED — without these the
 * Discover carousel (correctly) renders nothing in dev and looks broken.
 * picsum URLs are stable placeholders; offline, the carousel's own gradient
 * fallback carries the title instead.
 */
async function seedPromotions(fest, users) {
  const promotions = [
    {
      title: "Power Your Passion",
      promotionType: PROMOTION_TYPES.COMMERCIAL,
      imageUrl: "https://picsum.photos/seed/dedal-promo-tech/1200/675",
      linkUrl: "https://example.com/sponsor",
      description: "Student discounts on laptops and audio, all fest week.",
      displayOrder: 1,
    },
    {
      title: "Fuel the Fest",
      promotionType: PROMOTION_TYPES.COMMERCIAL,
      imageUrl: "https://picsum.photos/seed/dedal-promo-food/1200/675",
      description: "Meal combos at every Alliance ONE counter.",
      displayOrder: 2,
    },
    {
      title: "Alliance ONE 2026",
      promotionType: PROMOTION_TYPES.COLLEGE_EVENT,
      imageUrl: "https://picsum.photos/seed/dedal-promo-fest/1200/675",
      collegeName: "Alliance University",
      description: "Nine schools. One pass. Registrations open now.",
      displayOrder: 1,
    },
  ];
  for (const promotion of promotions) {
    await PromotionModel.create({
      ...promotion,
      status: PROMOTION_STATUSES.PUBLISHED,
      createdByUserId: users.collegeAdmin._id,
    });
  }
  console.log(`Seeded ${promotions.length} published promotions.`);
}

/*
 * Registers the first five participants through the real solo-registration
 * service, so passes and entitlements are created by the production flow. Returns
 * each participant's Mindspark registration id, for scoring.
 */
async function seedRegistrations(users, eventsByKey) {
  const mindsparkRegByPhone = {};
  let count = 0;

  for (const plan of REGISTRATION_PLAN) {
    const participant = users.participantsByPhone[plan.participantPhone];
    for (const eventKey of plan.eventKeys) {
      const result = await registerParticipantSolo(
        participant._id,
        eventsByKey[eventKey]._id,
        {
          foodPreference: plan.foodPreference,
          needsAccommodation: plan.needsAccommodation,
          customResponses: [],
          hasAcceptedMedicalDeclaration: false,
        }
      );
      count += 1;
      if (eventKey === "mindspark") {
        mindsparkRegByPhone[plan.participantPhone] = result.registration.id || result.registration._id;
      }
    }
  }

  console.log(`Seeded ${count} solo registrations (${REGISTRATION_PLAN.length} participants x 3 events).`);
  return mindsparkRegByPhone;
}

async function seedScores(users, eventsByKey, mindsparkRegByPhone) {
  const mindsparkId = eventsByKey.mindspark._id;
  const actorUserId = users.collegeAdmin._id;
  const festId = eventsByKey.mindspark.festId;

  const { createdCount } = await initializeScores(mindsparkId);

  for (const participant of PARTICIPANTS) {
    if (participant.mindsparkScore === undefined) {
      continue;
    }
    const registrationId = mindsparkRegByPhone[participant.phoneNumber];
    const scoreRow = await getScoreForRegistration(mindsparkId, registrationId);
    await updateScore({
      eventId: mindsparkId,
      registrationId,
      newScore: participant.mindsparkScore,
      expectedVersion: scoreRow.version,
      actorUserId,
      isAdministrator: true,
      festId,
    });
  }

  await finalizeScores({ eventId: mindsparkId, actorUserId, festId });
  console.log(`Seeded Mindspark Quiz scores: initialized ${createdCount}, set 5, finalized.`);
}

async function seedAchievements(users, eventsByKey) {
  const actorUserId = users.collegeAdmin._id;

  const { awardedCount } = await awardEventResults(eventsByKey.mindspark._id, actorUserId);

  let badgeUsers = 0;
  for (const plan of REGISTRATION_PLAN) {
    const participant = users.participantsByPhone[plan.participantPhone];
    await awardBadges(participant._id);
    badgeUsers += 1;
  }

  for (const declaration of SELF_DECLARED_ACHIEVEMENTS) {
    const participant = users.participantsByPhone[declaration.participantPhone];
    await addSelfDeclaredAchievement(participant._id, {
      title: declaration.title,
      description: declaration.description,
    });
  }

  console.log(
    `Seeded achievements: ${awardedCount} event results, badges awarded for ${badgeUsers} participants, ` +
      `${SELF_DECLARED_ACHIEVEMENTS.length} self-declared.`
  );
}

async function printSummary() {
  const counts = await Promise.all(ALL_MODELS.map((model) => model.countDocuments()));
  console.log("--- Alliance ONE 2026 seed summary ---");
  ALL_MODELS.forEach((model, index) => {
    console.log(`${model.modelName.padEnd(24)} ${counts[index]}`);
  });
}

/*
 * The one exported entry point. Assumes a live mongoose connection (the runner
 * establishes it). Resets, then seeds — idempotent across re-runs.
 */
async function seedAllianceOne() {
  if (!applicationConfig.isDevelopment) {
    throw new Error("seedAllianceOne refuses to run: APPLICATION_ENVIRONMENT must be 'development'.");
  }

  await resetDatabase();
  // The legal texts first: every consent recorded later needs a version to name.
  const { seedPolicyRegistryFromBundledText } = require("../services/consent-service");
  await seedPolicyRegistryFromBundledText();
  const colleges = await seedColleges();
  const users = await seedUsers(colleges);
  const fest = await seedFest(colleges, users.collegeAdmin);
  const eventsByKey = await seedEvents(fest, users.collegeAdmin);
  await seedStaffAssignments(fest, colleges, users, eventsByKey);
  const checkpoints = await seedCheckpoints(fest, eventsByKey);
  await seedVolunteerShifts(fest, users, checkpoints);
  await seedPromotions(fest, users);
  const mindsparkRegByPhone = await seedRegistrations(users, eventsByKey);
  await seedScores(users, eventsByKey, mindsparkRegByPhone);
  await seedAchievements(users, eventsByKey);
  await printSummary();
}

module.exports = { seedAllianceOne };
