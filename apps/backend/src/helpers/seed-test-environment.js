/*
 * Dev seed for Dedal. Provisions one college, the administrator, the
 * admin's staff assignment, a demo fest, its events, and checkpoints — idempotent,
 * so re-running finds existing rows rather than duplicating them.
 *
 * Note: the admin is provisioned with staffAssignments only, never participant
 * data. If the admin ever accidentally acquires participant rows (registrations,
 * passes, certificates, team memberships), run `npm run db:cleanup:admin` to purge
 * them — a separate one-time manual tool, deliberately NOT invoked from here.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");
const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ensureGateCheckpoint, ensureEventEntryCheckpoint } = require("./checkpoint-helpers");
const { EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES } = require("../services/pass-service");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  QUESTION_TYPES,
} = require("../constants/event-constants");
const { generateQuestionId } = require("./generate-question-id");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// LOCAL-TESTING HOTFIX (STEP-D12): the demo fest + event windows below are
// anchored to "right now" so that seeded staff assignments land inside an
// ACTIVE fest window and coordinator/scanner tiles show up on Home immediately.
// This is deliberately NON-DETERMINISTIC and is for LOCAL TESTING CONVENIENCE
// ONLY — it is NOT suitable for production, staging, or any shared/demo data
// that needs stable dates.
//
// To move the demo to a fixed FUTURE date instead, change the offsets below:
//   - fest window:  utcMidnightDaysFromNow(FEST_START_OFFSET_DAYS / _END_)
//   - event times:  the addHours(now, ...) offsets in eventDefinitions()
// Replace `now` with a fixed anchor date and adjust the offsets accordingly.
// ---------------------------------------------------------------------------
console.warn(
  "[seed] WARNING: demo fest/event dates are anchored to NOW for local testing only — NOT for production. Edit the offsets in seed-test-environment.js to use fixed dates."
);

// A whole calendar day at UTC midnight, `days` from today — fest dates are semantic days.
function utcMidnightDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/*
 * The last instant of a day rather than the first. A fest's endsOn is the bound
 * on gate access, so midnight-on-day-three ends the fest as day three begins —
 * the demo gate would start refusing passes on the morning of its own last day.
 */
function utcEndOfDayDaysFromNow(days) {
  const date = utcMidnightDaysFromNow(days);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}
function addHours(base, hours) {
  return new Date(base.getTime() + hours * HOUR_MS);
}

async function seedCollege() {
  const existing = await CollegeModel.findOne({ aisheCode: "U-0576" });
  if (existing) {
    return existing;
  }
  return CollegeModel.create({
    collegeName: "Alliance University",
    commonName: "Alliance University",
    city: "Bengaluru",
    state: "Karnataka",
    aisheCode: "U-0576",
    isVerified: true,
  });
}

async function seedAdmin(collegeId) {
  const emailAddress = applicationConfig.seedAdminEmail;
  const existing = await UserModel.findOne({ emailAddress });
  if (existing) {
    return existing;
  }
  const now = new Date();
  return UserModel.create({
    emailAddress,
    fullName: "Demo Admin",
    collegeId,
    usn: "ADMIN-0001",
    yearOfStudy: 4,
    department: "Administration",
    isProfileComplete: true,
    emailVerifiedAt: now,
    signedUpAt: now,
  });
}

/*
 * The product owner: a platform-scoped superadmin, separate from the college admin.
 * Kept college-less on purpose — it is over every college, not of one — and profile-
 * complete so it never detours through the participant profile flow.
 */
async function seedPlatformAdmin() {
  const emailAddress = applicationConfig.platformAdminEmail;
  let user = await UserModel.findOne({ emailAddress });
  if (!user) {
    const now = new Date();
    user = await UserModel.create({
      emailAddress,
      fullName: "Product Owner",
      isProfileComplete: true,
      emailVerifiedAt: now,
      signedUpAt: now,
    });
  }

  const existing = await StaffAssignmentModel.findOne({
    userId: user._id,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });
  if (!existing) {
    await StaffAssignmentModel.create({
      userId: user._id,
      collegeId: null,
      festId: null,
      role: STAFF_ROLES.PLATFORM_ADMIN,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
      validFrom: new Date(Date.now() - DAY_MS),
      validTo: null,
      assignedByUserId: user._id,
    });
  }
  return user;
}

async function seedAdminAssignment(userId, collegeId) {
  const existing = await StaffAssignmentModel.findOne({
    userId,
    collegeId,
    festId: null,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });
  if (existing) {
    return existing;
  }
  return StaffAssignmentModel.create({
    userId,
    collegeId,
    festId: null,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    validFrom: new Date(Date.now() - DAY_MS),
    validTo: null,
    assignedByUserId: userId,
  });
}

async function seedFest(collegeId, adminId, adminEmail) {
  const existing = await FestModel.findOne({ festSlug: "demo-fest", hostCollegeId: collegeId });
  if (existing) {
    return existing;
  }
  return FestModel.create({
    festName: "Demo Fest 2027",
    festSlug: "demo-fest",
    hostCollegeId: collegeId,
    description:
      "A testing playground fest for the launch. Register for an event, collect your pass, and try the full flow end to end.",
    startsOn: utcMidnightDaysFromNow(0),
    endsOn: utcEndOfDayDaysFromNow(3),
    visibility: FEST_VISIBILITIES.PUBLIC,
    allowedCollegeIds: [],
    contactEmail: adminEmail,
    status: FEST_STATUSES.PUBLISHED,
    createdByUserId: adminId,
  });
}

function eventDefinitions(fest, adminId) {
  // Event windows are anchored to NOW (not to the fest's UTC-midnight startsOn)
  // so that they fall inside the ACTIVE fest window for local scanner testing.
  // See the LOCAL-TESTING HOTFIX banner at the top of the file.
  const now = new Date();
  const shared = {
    festId: fest._id,
    createdByUserId: adminId,
    status: EVENT_STATUSES.PUBLISHED,
    capacity: 20,
    waitlistEnabled: true,
    feeAmountPaise: 0,
    registeredCount: 0,
    // Stated rather than left to the model's default, so no seeded event is
    // ambiguous about whether it asks for a declaration. 5K Fun Run overrides it.
    requiresMedicalDeclaration: false,
  };
  // Registration opens now and closes 12 hours before the given event's startsAt.
  // The short local-testing events (Solo +1h, Team +2h) start sooner than 12h
  // from now, so a literal "12h before startsAt" would land in the past and the
  // Event model rejects registrationClosesAt <= registrationOpensAt. Clamp the
  // close time into (now, startsAt]: it's 12h-before when that's feasible (Chess),
  // and closes at event start otherwise — keeping registration open for testing.
  const registrationWindow = (startsAt) => {
    const twelveHoursBefore = addHours(startsAt, -12).getTime();
    const closesAt = new Date(
      Math.min(startsAt.getTime(), Math.max(twelveHoursBefore, now.getTime() + HOUR_MS))
    );
    return { registrationOpensAt: now, registrationClosesAt: closesAt };
  };

  const soloStartsAt = addHours(now, 1);
  const teamStartsAt = addHours(now, 2);
  const chessStartsAt = addHours(now, 24); // tomorrow, now-ish
  const runStartsAt = addHours(now, 26); // fest day 2 morning

  return [
    {
      ...shared,
      eventName: "Solo Coding Sprint",
      eventSlug: "solo-coding",
      description: "A timed solo coding challenge — bring your laptop.",
      category: EVENT_CATEGORIES.TECHNICAL,
      eventType: EVENT_TYPES.SOLO,
      scoringFormat: EVENT_SCORING_FORMATS.SCORE_BASED,
      venue: "Main auditorium",
      startsAt: soloStartsAt,
      endsAt: addHours(now, 4),
      ...registrationWindow(soloStartsAt),
    },
    {
      ...shared,
      eventName: "Team Hackathon",
      eventSlug: "team-hackathon",
      description: "Build something useful in a day, as a team of two to four.",
      category: EVENT_CATEGORIES.TECHNICAL,
      eventType: EVENT_TYPES.TEAM,
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
      venue: "Lab 2",
      startsAt: teamStartsAt,
      endsAt: addHours(now, 24),
      ...registrationWindow(teamStartsAt),
    },
    {
      ...shared,
      eventName: "Chess Knockout",
      eventSlug: "chess-knockout",
      description: "A single-elimination chess bracket. Winner takes all.",
      category: EVENT_CATEGORIES.SPORTS,
      eventType: EVENT_TYPES.SOLO,
      scoringFormat: EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION,
      venue: "Chess room",
      startsAt: chessStartsAt,
      endsAt: addHours(now, 30), // tomorrow + 6 hours
      ...registrationWindow(chessStartsAt),
    },
    /*
     * The physical event: the only seeded one that demands the medical
     * declaration, so the whole safety flow is testable without editing an
     * existing event. Chess stays declaration-free on purpose — it is the
     * control case for "registers with no prompt at all".
     */
    {
      ...shared,
      eventName: "5K Fun Run",
      eventSlug: "5k-fun-run",
      description: "A 5 kilometre run around the college grounds. Bring water.",
      category: EVENT_CATEGORIES.SPORTS,
      eventType: EVENT_TYPES.SOLO,
      scoringFormat: EVENT_SCORING_FORMATS.TIME_TRIAL,
      venue: "College grounds",
      capacity: 30,
      requiresMedicalDeclaration: true,
      startsAt: runStartsAt,
      endsAt: addHours(runStartsAt, 3),
      ...registrationWindow(runStartsAt),
    },
  ];
}

/*
 * Demo registration questions, one per event that has any. Chess Knockout is
 * absent on purpose: it stays the frictionless event to register for while
 * testing. Keyed by slug rather than folded into eventDefinitions because an
 * event that already exists is never rebuilt from its definition, and these
 * still have to reach it.
 */
const CUSTOM_QUESTIONS_BY_SLUG = {
  "solo-coding": [
    {
      questionText: "Dietary preference?",
      questionType: QUESTION_TYPES.SINGLE_CHOICE,
      options: ["Veg", "Non-veg"],
      isRequired: true,
    },
  ],
  "team-hackathon": [
    {
      questionText: "Do you have a laptop?",
      questionType: QUESTION_TYPES.YES_NO,
      isRequired: true,
    },
  ],
};

/*
 * Idempotent on questionText: re-running finds the question already there and
 * leaves it alone, so its questionId stays stable and answers already given to
 * it keep resolving.
 */
async function ensureCustomQuestions(event) {
  const desiredQuestions = CUSTOM_QUESTIONS_BY_SLUG[event.eventSlug] || [];
  const addedQuestions = [];

  for (const desired of desiredQuestions) {
    const alreadyPresent = event.customQuestions.some(
      (question) => question.questionText === desired.questionText
    );
    if (alreadyPresent) {
      continue;
    }
    event.customQuestions.push({
      ...desired,
      questionId: generateQuestionId(),
      displayOrder: event.customQuestions.length + 1,
    });
    addedQuestions.push(desired.questionText);
  }

  if (addedQuestions.length > 0) {
    await event.save();
  }
  return addedQuestions;
}

/*
 * The event windows are anchored to NOW (see the banner at the top), but finding
 * an existing event by slug used to mean keeping whatever dates it was first
 * seeded with. An hour later its registration window had passed and re-seeding
 * could not reopen it — only a full db:reset could, which costs every
 * registration and scan made while testing.
 *
 * So re-seeding re-anchors the schedule instead. All four dates move together:
 * the model checks them against each other, and definition already holds a
 * consistent set.
 */
const SCHEDULE_FIELDS = ["startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt"];

async function refreshEventSchedule(event, definition) {
  const hasDrifted = SCHEDULE_FIELDS.some(
    (field) => event[field].getTime() !== definition[field].getTime()
  );
  if (!hasDrifted) {
    return false;
  }

  for (const field of SCHEDULE_FIELDS) {
    event[field] = definition[field];
  }
  await event.save();
  return true;
}

/*
 * Brings an event seeded before this field existed up to its stated value. The
 * seed owns the flag on its demo events, so a re-run resets a hand-toggled one —
 * the same bargain the schedule re-anchoring already makes.
 */
async function refreshMedicalFlag(event, definition) {
  if (event.requiresMedicalDeclaration === definition.requiresMedicalDeclaration) {
    return false;
  }
  event.requiresMedicalDeclaration = definition.requiresMedicalDeclaration;
  await event.save();
  return true;
}

async function seedEvents(fest, adminId) {
  const events = [];
  for (const definition of eventDefinitions(fest, adminId)) {
    const existing = await EventModel.findOne({ festId: fest._id, eventSlug: definition.eventSlug });
    const event = existing || (await EventModel.create(definition));

    if (existing && (await refreshEventSchedule(event, definition))) {
      console.log(
        `  Re-anchored ${event.eventName} to now: registration ` +
          `${event.registrationOpensAt.toISOString()} -> ${event.registrationClosesAt.toISOString()}`
      );
    }
    if (existing && (await refreshMedicalFlag(event, definition))) {
      console.log(
        `  Set requiresMedicalDeclaration=${event.requiresMedicalDeclaration} on ${event.eventName}`
      );
    }
    if (event.requiresMedicalDeclaration) {
      console.log(`  ${event.eventName} REQUIRES the medical declaration to register`);
    }

    const addedQuestions = await ensureCustomQuestions(event);
    for (const questionText of addedQuestions) {
      console.log(`  Added custom question to ${event.eventName}: "${questionText}"`);
    }

    events.push(event);
  }
  return events;
}

/*
 * The demo events sit 1–26 hours out, so anyone testing the scanner is scanning
 * a door whose event has not started. Saying so here saves them wondering
 * whether an accepted scan at a door hours before kick-off is a bug.
 */
async function seedCheckpoints(fest, events) {
  await ensureGateCheckpoint(fest._id);
  for (const event of events) {
    await ensureEventEntryCheckpoint(fest._id, event._id, event.eventName);
  }
  console.log(
    `  Event entry doors open immediately; validity ends at event.endsAt + ` +
      `${EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES / 60}h grace`
  );
}

async function printSummary() {
  const [colleges, users, staffAssignments, fests, events, checkpoints] = await Promise.all([
    CollegeModel.countDocuments(),
    UserModel.countDocuments(),
    StaffAssignmentModel.countDocuments(),
    FestModel.countDocuments(),
    EventModel.countDocuments(),
    CheckpointModel.countDocuments(),
  ]);
  console.log("--- Seed summary ---");
  console.log(`Colleges:          ${colleges}`);
  console.log(`Users:             ${users}`);
  console.log(`Staff assignments: ${staffAssignments}`);
  console.log(`Fests:             ${fests}`);
  console.log(`Events:            ${events}`);
  console.log(`Checkpoints:       ${checkpoints}`);
}

async function runSeed() {
  if (!applicationConfig.isDevelopment) {
    throw new Error(
      "db:seed:test refuses to run: APPLICATION_ENVIRONMENT must be 'development' to seed the database."
    );
  }

  await connectToDatabase();

  // The legal texts, so profile completion can record provable consent locally.
  const { seedPolicyRegistryFromBundledText } = require("../services/consent-service");
  const policyVersions = await seedPolicyRegistryFromBundledText();
  console.log(`Seeded ${policyVersions.length} policy document version(s) from bundled text`);

  const college = await seedCollege();
  console.log(`Seeded college ${college.commonName} (${college.id})`);

  const admin = await seedAdmin(college._id);
  console.log(`Seeded admin ${admin.emailAddress} (${admin.id})`);

  await seedAdminAssignment(admin._id, college._id);
  console.log("Seeded administrator assignment");

  const platformAdmin = await seedPlatformAdmin();
  console.log(`Seeded platform owner ${platformAdmin.emailAddress} (${platformAdmin.id})`);

  const fest = await seedFest(college._id, admin._id, admin.emailAddress);
  console.log(`Seeded fest ${fest.festName} (${fest.id})`);
  console.log(`  Fest window: startsOn ${fest.startsOn.toISOString()} -> endsOn ${fest.endsOn.toISOString()}`);

  const events = await seedEvents(fest, admin._id);
  console.log(`Seeded ${events.length} events: ${events.map((event) => event.eventName).join(", ")}`);
  for (const event of events) {
    console.log(
      `  ${event.eventName}: startsAt ${event.startsAt.toISOString()} -> endsAt ${event.endsAt.toISOString()}` +
        ` | registration ${event.registrationOpensAt.toISOString()} -> ${event.registrationClosesAt.toISOString()}`
    );
  }

  await seedCheckpoints(fest, events);
  console.log("Seeded checkpoints (1 gate + 1 per event)");

  await printSummary();
}

async function main() {
  let exitCode = 0;
  try {
    await runSeed();
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exit(exitCode);
}

main();
