/*
 * One-off, production-safe migration: creates the Alliance ONE 2026 fest, its
 * host-college link, an administrator account, and the full event hierarchy.
 * `npm run migrate:alliance-one`.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE SEED
 * `seed-alliance-one.js` is hard-gated to APPLICATION_ENVIRONMENT=development
 * and, by design, WIPES every collection before rebuilding. Neither is
 * acceptable against a live database, so it can never be the production path.
 * This migration reuses the same EVENT_TREE data through insert-only,
 * idempotent writes: nothing is deleted, nothing existing is modified.
 *
 * IDEMPOTENT BY CONSTRUCTION
 * Every step looks the record up first and creates only what is absent. The
 * fest is matched by name, each event by (festId, eventName), the admin by
 * email, and the staff assignment by (userId, role). Re-running reports
 * everything as skipped.
 *
 * CONFIGURATION (all optional)
 *   ALLIANCE_ADMIN_EMAIL   the account that will own and administer the fest.
 *                          Defaults to SEED_ADMIN_EMAIL. This address must be
 *                          the one you sign in with — `GET /fests/mine` filters
 *                          on createdByUserId, so a fest owned by anyone else
 *                          is invisible in the admin console.
 *   ALLIANCE_FEST_STARTS_ON / ALLIANCE_FEST_ENDS_ON
 *                          ISO dates (YYYY-MM-DD) bounding the fest. Defaults
 *                          span two days ago through thirty days out, so the
 *                          fest reads as live now and still encloses a demo a
 *                          few weeks away. Set them explicitly for a real fest.
 *
 * To add another fest later, copy this file and swap the data table — the
 * structure is deliberately one fest per migration.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");

const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");

const { generateFestSlug } = require("./generate-fest-slug");
const { insertFestWithUniqueSlug } = require("./insert-fest-with-unique-slug");
const { insertEventWithUniqueSlug } = require("./insert-event-with-unique-slug");

const { EVENT_TREE, FREE_REGISTRATION_TARGETS } = require("./seed-alliance-one-data");

const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const {
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  FEE_TYPES,
} = require("../constants/event-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

const FEST_NAME = "Alliance ONE 2026";
const HOST_COLLEGE_NAME = "Alliance University";
const VENUE = "Alliance University, Bengaluru";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_START_DAYS_FROM_NOW = -2;
const DEFAULT_END_DAYS_FROM_NOW = 30;

function utcMidnightDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/*
 * An explicit ISO date wins over the relative default. Parsed as UTC midnight so
 * the window does not shift with the server's timezone.
 */
function resolveFestBoundary(variableName, defaultDaysFromNow, endOfDay) {
  const rawValue = process.env[variableName];
  const date = rawValue
    ? new Date(`${rawValue.trim()}T00:00:00.000Z`)
    : utcMidnightDaysFromNow(defaultDaysFromNow);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Environment variable ${variableName} must be an ISO date (YYYY-MM-DD).`);
  }
  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/*
 * Spreads leaves evenly across the fest window rather than reusing the seed's
 * "always live right now" shape, which assumes a fest that started two days ago
 * and ends in five. Registration opens immediately and closes when the event
 * starts, so every event is registerable from the moment this runs.
 */
function buildEventSchedule({ isContainer, leafIndex, leafTotal, festStartsOn, festEndsOn, now }) {
  const firstEventDay = new Date(Math.max(festStartsOn.getTime(), now.getTime()));
  const windowMs = Math.max(festEndsOn.getTime() - firstEventDay.getTime(), DAY_MS);

  let startsAt;
  let endsAt;
  if (isContainer) {
    // A container must enclose every child, so it spans the whole window.
    startsAt = new Date(firstEventDay.getTime() + HOUR_MS);
    endsAt = new Date(festEndsOn.getTime());
  } else {
    // Leave the last day free so an event never starts after the fest ends.
    const position = leafTotal > 1 ? leafIndex / leafTotal : 0;
    const offsetMs = Math.floor(windowMs * position * 0.9);
    startsAt = new Date(firstEventDay.getTime() + offsetMs + 10 * HOUR_MS);
    endsAt = new Date(Math.min(startsAt.getTime() + 7 * HOUR_MS, festEndsOn.getTime()));
  }

  return {
    startsAt,
    endsAt,
    registrationOpensAt: new Date(now.getTime() - HOUR_MS),
    registrationClosesAt: new Date(startsAt.getTime()),
  };
}

async function resolveHostCollege() {
  const college = await CollegeModel.findOne({
    $or: [{ collegeName: HOST_COLLEGE_NAME }, { commonName: HOST_COLLEGE_NAME }],
  });
  if (college) {
    return { college, created: false };
  }

  const createdCollege = await CollegeModel.create({
    collegeName: HOST_COLLEGE_NAME,
    commonName: "Alliance",
    city: "Bangalore",
    state: "Karnataka",
    collegeType: "business",
    isVerified: true,
  });
  return { college: createdCollege, created: true };
}

async function resolveAdministrator() {
  const emailAddress = (
    process.env.ALLIANCE_ADMIN_EMAIL || applicationConfig.seedAdminEmail
  )
    .trim()
    .toLowerCase();

  const existingUser = await UserModel.findOne({ emailAddress });
  if (existingUser) {
    return { administrator: existingUser, emailAddress, created: false };
  }

  const administrator = await UserModel.create({
    emailAddress,
    fullName: "Alliance ONE Administrator",
    // Set directly rather than recomputed: an administrator has no USN, and
    // recomputing would mark the profile incomplete and trap them on the
    // profile-completion screen.
    isProfileComplete: true,
    /*
     * participantId is deliberately OMITTED, not set to null. It carries a
     * unique sparse index and no default, so the index skips the field only
     * while it is absent — an explicit null would collide with the next
     * administrator created this way. An admin has no phone number to derive
     * one from anyway.
     */
  });
  return { administrator, emailAddress, created: true };
}

/*
 * The platform-admin assignment carries no college and no fest — it is the
 * god-mode role that passes every college and fest admin check, so the account
 * can administer this fest without a per-college assignment as well.
 */
async function ensurePlatformAdministrator(administrator) {
  const existingAssignment = await StaffAssignmentModel.findOne({
    userId: administrator._id,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });
  if (existingAssignment) {
    return false;
  }

  await StaffAssignmentModel.create({
    userId: administrator._id,
    collegeId: null,
    festId: null,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    assignedByUserId: administrator._id,
  });
  return true;
}

async function resolveFest(hostCollege, administrator) {
  const existingFest = await FestModel.findOne({ festName: FEST_NAME });
  if (existingFest) {
    return { fest: existingFest, created: false };
  }

  const attributes = {
    festName: FEST_NAME,
    hostCollegeId: hostCollege._id,
    description: "Alliance University's flagship inter-college fest across nine schools.",
    startsOn: resolveFestBoundary("ALLIANCE_FEST_STARTS_ON", DEFAULT_START_DAYS_FROM_NOW, false),
    endsOn: resolveFestBoundary("ALLIANCE_FEST_ENDS_ON", DEFAULT_END_DAYS_FROM_NOW, true),
    visibility: FEST_VISIBILITIES.PUBLIC,
    allowedCollegeIds: [],
    contactEmail: administrator.emailAddress,
    // Published, or it would not appear in the public catalogue at all —
    // listPublicFests filters on status.
    status: FEST_STATUSES.PUBLISHED,
    createdByUserId: administrator._id,
    offers: [
      { offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true },
      { offerName: "Accommodation", offerKey: "accommodation", requiresQuantity: false, isActive: true },
    ],
  };

  const fest = await insertFestWithUniqueSlug(attributes, generateFestSlug(FEST_NAME));
  return { fest, created: true };
}

/*
 * Walks the tree parents-first so a child always finds its parent's ObjectId.
 * Existing events are adopted into the key map rather than recreated, so a
 * partial previous run completes cleanly instead of duplicating.
 */
async function createMissingEvents(fest, administrator) {
  const now = new Date();
  const eventByKey = {};
  let leafIndex = 0;
  let addedCount = 0;
  let skippedCount = 0;

  const leafTotal = EVENT_TREE.filter((node) => !node.container).length;

  for (const node of EVENT_TREE) {
    const existingEvent = await EventModel.findOne({ festId: fest._id, eventName: node.name });
    if (existingEvent) {
      eventByKey[node.key] = existingEvent;
      skippedCount += 1;
      if (!node.container) {
        leafIndex += 1;
      }
      continue;
    }

    const isContainer = Boolean(node.container);
    const isFreeTarget = FREE_REGISTRATION_TARGETS.has(node.key);
    const isTeam = !isContainer && node.type === EVENT_TYPES.TEAM;
    const parentEvent = node.parent ? eventByKey[node.parent] : null;

    const schedule = buildEventSchedule({
      isContainer,
      leafIndex,
      leafTotal,
      festStartsOn: fest.startsOn,
      festEndsOn: fest.endsOn,
      now,
    });

    const attributes = {
      festId: fest._id,
      parentEventId: parentEvent ? parentEvent._id : null,
      eventName: node.name,
      description: isContainer
        ? `${node.name} — a grouping of ${FEST_NAME} events.`
        : `${node.name}, part of ${FEST_NAME}.`,
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
      createdByUserId: administrator._id,
      ...schedule,
    };

    eventByKey[node.key] = await insertEventWithUniqueSlug(attributes, slugify(node.name));
    addedCount += 1;
    if (!isContainer) {
      leafIndex += 1;
    }
  }

  return { addedCount, skippedCount };
}

async function migrateAllianceOneFest() {
  await connectToDatabase();

  const { college: hostCollege, created: collegeCreated } = await resolveHostCollege();
  console.log(
    `Host college: ${hostCollege.collegeName} (${collegeCreated ? "created" : "already existed"}).`
  );

  const { administrator, emailAddress, created: adminCreated } = await resolveAdministrator();
  console.log(`Administrator: ${emailAddress} (${adminCreated ? "created" : "already existed"}).`);

  const assignmentCreated = await ensurePlatformAdministrator(administrator);
  console.log(
    `Platform-admin assignment: ${assignmentCreated ? "created" : "already existed"}.`
  );

  const { fest, created: festCreated } = await resolveFest(hostCollege, administrator);
  console.log(
    `Fest: ${fest.festName} (${fest.festSlug}) status=${fest.status} — ` +
      `${festCreated ? "created" : "already existed"}.`
  );

  if (!festCreated && String(fest.createdByUserId) !== String(administrator._id)) {
    console.warn(
      `WARNING: the existing fest is owned by a different user (${fest.createdByUserId}). ` +
        `GET /fests/mine filters on createdByUserId, so it will NOT appear in ${emailAddress}'s ` +
        `admin console. Sign in as the owning account, or reassign ownership deliberately.`
    );
  }
  if (fest.status !== FEST_STATUSES.PUBLISHED) {
    console.warn(
      `WARNING: the existing fest is '${fest.status}', not 'published'. It will NOT appear in ` +
        `the public catalogue until it is published.`
    );
  }

  const { addedCount, skippedCount } = await createMissingEvents(fest, administrator);
  const totalEvents = await EventModel.countDocuments({ festId: fest._id });
  console.log(
    `Added ${addedCount} events. Skipped ${skippedCount} (already existed). Total ${totalEvents}.`
  );
  console.log("Migration complete.");

  // Drain the microtask queue so the lines above flush before process.exit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  let exitCode = 0;
  try {
    await migrateAllianceOneFest();
  } catch (error) {
    console.error(`Alliance ONE fest migration failed: ${error.message}`);
    console.error(error.stack);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
