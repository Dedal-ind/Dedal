// seed-flat-fest-demo.js
// A TWO-LAYER demo fest: fest → events, with no sub-events anywhere.
//
// The sibling seeder (seed-event-structure-demo.js) builds the three-layer shape
// — fest → main event → verticals — which is the only shape a contingent could
// hang off before fest-level bundles existed. This one builds the shape that
// feature was added for: a fest whose events ARE the top level, so the only
// place a bundle can hang is the fest root box itself.
//
// Same safety rules as its sibling, for the same reasons:
//   · INSERT-ONLY — touches nothing else, deletes nothing.
//   · IDEMPOTENT — refuses to run if the demo fest slug already exists.
//   · The owner is resolved from a LIVE staff assignment, because
//     fetchFestsForAdministrator lists fests by createdByUserId — a fest owned
//     by anyone else would seed fine and then be invisible in the fest picker.
//
// Every event is SOLO, PUBLISHED and priced. All three matter: the contingent
// service refuses a team event (the buyer cannot form a team on the attendee's
// behalf), refuses an unpublished one, and prices the "you save ₹X" line off the
// included events' own fees — a bundle of free events has nothing to discount.
//
// Run with: npm run seed:demo-flat-fest
// Clean up with the two commands printed at the end.

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");
const { EventModel } = require("../src/models/event-model");
const { CollegeModel } = require("../src/models/college-model");
const { StaffAssignmentModel } = require("../src/models/staff-assignment-model");
const { FEST_STATUSES, FEST_VISIBILITIES } = require("../src/constants/fest-constants");
const {
  EVENT_STATUSES,
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  FEE_TYPES,
} = require("../src/constants/event-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");

const DEMO_FEST_SLUG = "flat-fest-demo";
const DEMO_FEST_NAME = "Flat Fest Demo";
const DEMO_CONTACT_EMAIL = "demo@alliance.edu.in";

/*
 * Five top-level events, no children. Fees are in rupees here and converted to
 * paise on the way in — every amount the system stores is an integer paise.
 */
const TOP_LEVEL_EVENTS = [
  { eventName: "Solo Singing", category: "Cultural", venue: "Main Auditorium", feeRupees: 200 },
  { eventName: "Poetry Slam", category: "Literary", venue: "Seminar Hall 3", feeRupees: 150 },
  { eventName: "Sketching", category: "Fine Arts", venue: "Studio 2", feeRupees: 100 },
  { eventName: "Quiz", category: "Literary", venue: "Block C Auditorium", feeRupees: 250 },
  { eventName: "Photography Walk", category: "Fine Arts", venue: "Main Quadrangle", feeRupees: 300 },
];

const PAISE_PER_RUPEE = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/*
 * The user the demo fest belongs to. An administrator is preferred over a
 * platformAdmin: their assignment carries the collegeId the fest needs, whereas
 * a platformAdmin's is deliberately college-less.
 */
async function resolveOwner() {
  const administrator = await StaffAssignmentModel.findOne({
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    collegeId: { $ne: null },
  }).sort({ createdAt: 1 });

  if (administrator) {
    return { userId: administrator.userId, collegeId: administrator.collegeId };
  }

  const platformAdmin = await StaffAssignmentModel.findOne({
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).sort({ createdAt: 1 });

  if (!platformAdmin) {
    return null;
  }

  const college = await CollegeModel.findOne().sort({ createdAt: 1 });
  if (!college) {
    return null;
  }
  return { userId: platformAdmin.userId, collegeId: college._id };
}

async function main() {
  const databaseUri = process.env.DATABASE_URI;
  if (!databaseUri) {
    throw new Error("DATABASE_URI is not set. Check backend/.env.");
  }

  await mongoose.connect(databaseUri);
  console.log("Connected to the database.");

  const existing = await FestModel.findOne({ festSlug: DEMO_FEST_SLUG });
  if (existing) {
    console.log(`The flat demo fest already exists (${existing._id}). Nothing was inserted.`);
    console.log("Remove it first if you want a clean reseed:");
    console.log(`  db.fests.deleteOne({_id: ObjectId('${existing._id}')});`);
    console.log(`  db.events.deleteMany({festId: ObjectId('${existing._id}')})`);
    return;
  }

  const owner = await resolveOwner();
  if (!owner) {
    throw new Error(
      "No active administrator (or platformAdmin plus a college) found. " +
        "Sign in as an admin at least once so the assignment exists, then rerun.",
    );
  }

  const college = await CollegeModel.findById(owner.collegeId);
  console.log(
    `Owner user: ${owner.userId} · host college: ${college?.collegeName ?? owner.collegeId}`,
  );

  const now = new Date();
  const startsOn = new Date(now.getTime() + 7 * DAY_MS);
  const endsOn = new Date(now.getTime() + 10 * DAY_MS);

  const fest = await FestModel.create({
    festName: DEMO_FEST_NAME,
    festSlug: DEMO_FEST_SLUG,
    hostCollegeId: owner.collegeId,
    description: "Seeded two-layer fest for verifying fest-level contingents.",
    startsOn,
    endsOn,
    visibility: FEST_VISIBILITIES.INTRA_COLLEGE,
    contactEmail: DEMO_CONTACT_EMAIL,
    status: FEST_STATUSES.PUBLISHED,
    createdByUserId: owner.userId,
  });
  console.log(`Flat demo fest created: ${fest._id}`);

  let individualTotalPaise = 0;

  for (const [index, specification] of TOP_LEVEL_EVENTS.entries()) {
    const startsAt = new Date(startsOn.getTime() + index * 3 * HOUR_MS);
    const feeAmountPaise = specification.feeRupees * PAISE_PER_RUPEE;
    individualTotalPaise += feeAmountPaise;

    const event = await EventModel.create({
      festId: fest._id,
      createdByUserId: owner.userId,
      scoringFormat: EVENT_SCORING_FORMATS.NONE,
      /* null parent IS the point of this fixture: these are the top level. */
      parentEventId: null,
      eventName: specification.eventName,
      eventSlug: slugify(specification.eventName),
      description: `${specification.eventName} — top-level demo event.`,
      category: specification.category,
      eventType: EVENT_TYPES.SOLO,
      minimumTeamSize: 1,
      maximumTeamSize: 1,
      venue: specification.venue,
      capacity: 60,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR_MS),
      registrationOpensAt: now,
      // The model rejects a close time at or after the event's own end.
      registrationClosesAt: new Date(startsAt.getTime() - HOUR_MS),
      feeType: FEE_TYPES.PER_PERSON,
      feeAmountPaise,
      status: EVENT_STATUSES.PUBLISHED,
    });
    console.log(
      `  Event: ${event.eventName} → ${event._id} (₹${specification.feeRupees})`,
    );
  }

  console.log("");
  console.log(`Fest id: ${fest._id}`);
  console.log(`Top-level events: ${TOP_LEVEL_EVENTS.length} (no sub-events)`);
  console.log(`Sum of individual fees: ₹${individualTotalPaise / PAISE_PER_RUPEE}`);
  console.log(`Open: /admin/events/structure?festId=${fest._id}`);
  console.log("Then click the blue fest box at the top → Configure contingent.");
  console.log("To clean up later:");
  console.log(
    `db.fests.deleteOne({_id: ObjectId('${fest._id}')}); ` +
      `db.events.deleteMany({festId: ObjectId('${fest._id}')})`,
  );
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log("Disconnected.");
  });
