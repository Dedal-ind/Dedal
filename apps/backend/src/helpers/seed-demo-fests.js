/*
 * Dev-only convenience seed: creates 10 published, public demo fests (each with a
 * couple of events) so the Discover gallery and Event-detail pages have real content
 * to test against. Idempotent by fest slug — re-running skips fests already present.
 *
 * Reuses the college + admin provisioned by seed-test-environment.js. Run the base
 * seed first (npm run db:seed:test) if they don't exist yet. NOT for production.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");
const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
} = require("../constants/event-constants");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
function addHours(base, hours) {
  return new Date(base.getTime() + hours * HOUR_MS);
}

// 10 fests, spread from "started yesterday" through several weeks out, so Discover
// shows a mix of Happening-now and Upcoming, ordered by start date.
const FEST_BLUEPRINTS = [
  { name: "Rhythm & Roots", slug: "rhythm-and-roots", startOffset: -1, span: 3, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Neon Nights", slug: "neon-nights", startOffset: 0, span: 2, category: EVENT_CATEGORIES.GAMING },
  { name: "Cerebro Tech Fest", slug: "cerebro-tech-fest", startOffset: 2, span: 3, category: EVENT_CATEGORIES.TECHNICAL },
  { name: "Sportiva", slug: "sportiva", startOffset: 4, span: 2, category: EVENT_CATEGORIES.SPORTS },
  { name: "Canvas & Code", slug: "canvas-and-code", startOffset: 6, span: 2, category: EVENT_CATEGORIES.WORKSHOP },
  { name: "Aurora Cultural Meet", slug: "aurora-cultural-meet", startOffset: 9, span: 3, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Quantum Hack", slug: "quantum-hack", startOffset: 12, span: 2, category: EVENT_CATEGORIES.TECHNICAL },
  { name: "Verve Dance Fest", slug: "verve-dance-fest", startOffset: 16, span: 2, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Litmus Literary Fest", slug: "litmus-literary-fest", startOffset: 20, span: 2, category: EVENT_CATEGORIES.LITERARY },
  { name: "Odyssey 2027", slug: "odyssey-2027", startOffset: 25, span: 4, category: EVENT_CATEGORIES.OTHER },
];

function eventsForFest(fest, adminId, blueprint) {
  const now = new Date();
  const shared = {
    festId: fest._id,
    createdByUserId: adminId,
    status: EVENT_STATUSES.PUBLISHED,
    capacity: 40,
    waitlistEnabled: true,
    feeAmountPaise: 0,
    registeredCount: 0,
    requiresMedicalDeclaration: false,
  };
  const registrationWindow = (startsAt) => {
    const twelveHoursBefore = addHours(startsAt, -12).getTime();
    const closesAt = new Date(Math.min(startsAt.getTime(), Math.max(twelveHoursBefore, now.getTime() + HOUR_MS)));
    return { registrationOpensAt: now, registrationClosesAt: closesAt };
  };
  // Anchor events a little after the fest starts (but at least an hour out) so the
  // registration window is always open for testing.
  const base = new Date(Math.max(fest.startsOn.getTime(), now.getTime() + 2 * HOUR_MS));
  const firstStart = addHours(base, 1);
  const secondStart = addHours(base, 4);

  return [
    {
      ...shared,
      eventName: `${blueprint.name} — Flagship`,
      eventSlug: `${blueprint.slug}-flagship`,
      description: `The headline event of ${blueprint.name}. Register, grab your pass, and show up.`,
      category: blueprint.category,
      eventType: EVENT_TYPES.SOLO,
      scoringFormat: EVENT_SCORING_FORMATS.SCORE_BASED,
      venue: "Main auditorium",
      startsAt: firstStart,
      endsAt: addHours(firstStart, 3),
      ...registrationWindow(firstStart),
    },
    {
      ...shared,
      eventName: `${blueprint.name} — Team Challenge`,
      eventSlug: `${blueprint.slug}-team`,
      description: `A team event at ${blueprint.name}. Bring two to four people.`,
      category: blueprint.category,
      eventType: EVENT_TYPES.TEAM,
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
      venue: "Hall B",
      startsAt: secondStart,
      endsAt: addHours(secondStart, 3),
      ...registrationWindow(secondStart),
    },
  ];
}

async function main() {
  let exitCode = 0;
  try {
    if (!applicationConfig.isDevelopment) {
      throw new Error("Refusing to seed: APPLICATION_ENVIRONMENT must be 'development'.");
    }
    await connectToDatabase();

    const college = await CollegeModel.findOne({ aisheCode: "U-0576" });
    const admin = await UserModel.findOne({ emailAddress: applicationConfig.seedAdminEmail });
    if (!college || !admin) {
      throw new Error("College/admin not found. Run `npm run db:seed:test` first.");
    }

    let createdFests = 0;
    let createdEvents = 0;
    for (const blueprint of FEST_BLUEPRINTS) {
      let fest = await FestModel.findOne({ festSlug: blueprint.slug, hostCollegeId: college._id });
      if (!fest) {
        fest = await FestModel.create({
          festName: blueprint.name,
          festSlug: blueprint.slug,
          hostCollegeId: college._id,
          description: `${blueprint.name} — a demo fest seeded for testing. Explore events, register, and collect your pass.`,
          startsOn: utcMidnightDaysFromNow(blueprint.startOffset),
          endsOn: utcEndOfDayDaysFromNow(blueprint.startOffset + blueprint.span),
          visibility: FEST_VISIBILITIES.PUBLIC,
          allowedCollegeIds: [],
          contactEmail: admin.emailAddress,
          status: FEST_STATUSES.PUBLISHED,
          createdByUserId: admin._id,
        });
        createdFests += 1;
        console.log(`Created fest: ${fest.festName} (${fest.id})`);
      } else {
        console.log(`Fest exists, skipping: ${fest.festName}`);
      }

      for (const definition of eventsForFest(fest, admin._id, blueprint)) {
        const existing = await EventModel.findOne({ festId: fest._id, eventSlug: definition.eventSlug });
        if (!existing) {
          await EventModel.create(definition);
          createdEvents += 1;
        }
      }
    }

    const [fests, events] = await Promise.all([
      FestModel.countDocuments(),
      EventModel.countDocuments(),
    ]);
    console.log("--- Demo fests seed summary ---");
    console.log(`New fests created:  ${createdFests}`);
    console.log(`New events created: ${createdEvents}`);
    console.log(`Total fests:        ${fests}`);
    console.log(`Total events:       ${events}`);
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
