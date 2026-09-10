// seed-event-structure-demo.js
// One-time demo data for the Event Structure org chart: one fest with a
// four-wide, two-deep event hierarchy, so the chart has a real shape to draw
// instead of an empty state.
//
// Safe by design:
//   · INSERT-ONLY — touches nothing else, deletes nothing.
//   · IDEMPOTENT — refuses to run if the demo fest slug already exists, so a
//     rerun cannot leave two "Alliance One Demo" fests in the picker.
//   · The owning user is resolved from a LIVE staff assignment, because
//     fetchFestsForAdministrator lists fests by createdByUserId: a fest owned by
//     anyone else would be seeded successfully and then be invisible in the very
//     dropdown this data exists to populate.
//
// The fest is NOT created against a new college. hostCollegeId must reference a
// real College, and inventing one would put a fake institution in the college
// directory that outlives this fest. An administrator's assignment already names
// their college, so that is the one used; the wireframe's "Alliance University"
// is honoured only when the resolved admin genuinely belongs to it.
//
// Run with: npm run seed:demo-structure
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
} = require("../src/constants/event-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");

const DEMO_FEST_SLUG = "alliance-one-demo";
const DEMO_FEST_NAME = "Alliance One Demo";
const DEMO_CONTACT_EMAIL = "demo@alliance.edu.in";

const VENUES = [
  "Hall A",
  "Hall B",
  "Block B Room 201",
  "Block C Auditorium",
  "Main Quadrangle",
  "Seminar Hall 3",
];

/*
 * The hierarchy from the wireframe. Team sizes are a maximum; the model refuses
 * a team event with a minimum below 2, so every team leaf gets a minimum of 2
 * and solo leaves are pinned to 1/1.
 */
const MAIN_EVENTS = [
  {
    eventName: "Chaturanga",
    category: "management",
    status: EVENT_STATUSES.PUBLISHED,
    children: [
      { eventName: "Finance", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 5 },
      { eventName: "Marketing", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 4 },
      { eventName: "HR", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 4 },
      { eventName: "Operations", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 5 },
      { eventName: "Business Analytics", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 3 },
      { eventName: "Strategy", eventType: EVENT_TYPES.SOLO },
    ],
  },
  {
    eventName: "Inclusary",
    category: "cultural",
    status: EVENT_STATUSES.PUBLISHED,
    children: [
      { eventName: "Dance", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 8 },
      { eventName: "Music", eventType: EVENT_TYPES.SOLO },
      { eventName: "Drama", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 6 },
      { eventName: "Art", eventType: EVENT_TYPES.SOLO },
    ],
  },
  {
    eventName: "Gamecolon",
    category: "sports",
    status: EVENT_STATUSES.PUBLISHED,
    children: [
      { eventName: "Cricket", eventType: EVENT_TYPES.TEAM, maximumTeamSize: 11 },
      { eventName: "Chess", eventType: EVENT_TYPES.SOLO },
      { eventName: "Badminton", eventType: EVENT_TYPES.SOLO },
    ],
  },
  {
    eventName: "CultureFest",
    category: "cultural",
    status: EVENT_STATUSES.DRAFT,
    children: [
      { eventName: "Debate", eventType: EVENT_TYPES.SOLO, status: EVENT_STATUSES.DRAFT },
      {
        eventName: "Quiz",
        eventType: EVENT_TYPES.TEAM,
        maximumTeamSize: 3,
        status: EVENT_STATUSES.DRAFT,
      },
    ],
  },
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function randomBetween(minimum, maximum) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

/*
 * The user the demo fest belongs to.
 *
 * A college administrator is preferred over a platformAdmin: an administrator's
 * assignment carries the collegeId the fest needs, whereas a platformAdmin's is
 * deliberately college-less and would leave hostCollegeId unresolvable.
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

  /*
   * Falling back to a platformAdmin means finding them a college separately.
   * Any college will do for demo data — but if the database has none, there is
   * nothing valid to point hostCollegeId at and the script stops rather than
   * inventing an institution.
   */
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
    console.log(`The demo fest already exists (${existing._id}). Nothing was inserted.`);
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
    description: "Seeded demo fest for verifying the Event Structure org chart.",
    startsOn,
    endsOn,
    /*
     * intraCollege, not interCollege: an interCollege fest is required to name
     * at least one allowed college, and the only honest way to fill that list
     * for demo data would be to enrol real institutions in a fake fest.
     */
    visibility: FEST_VISIBILITIES.INTRA_COLLEGE,
    contactEmail: DEMO_CONTACT_EMAIL,
    status: FEST_STATUSES.PUBLISHED,
    createdByUserId: owner.userId,
  });
  console.log(`Demo fest created: ${fest._id}`);

  /*
   * Every event is scheduled inside the fest window and given a registration
   * window that closes an hour before it starts — the model rejects a
   * registration close at or after the event's own end.
   */
  const buildTimes = () => {
    const startsAt = new Date(startsOn.getTime() + randomBetween(0, 48) * HOUR_MS);
    const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
    return {
      startsAt,
      endsAt,
      registrationOpensAt: now,
      registrationClosesAt: new Date(startsAt.getTime() - HOUR_MS),
    };
  };

  const commonFields = {
    festId: fest._id,
    createdByUserId: owner.userId,
    scoringFormat: EVENT_SCORING_FORMATS.NONE,
  };

  let mainEventCount = 0;
  let subEventCount = 0;

  for (const [mainIndex, mainSpecification] of MAIN_EVENTS.entries()) {
    const mainEvent = await EventModel.create({
      ...commonFields,
      ...buildTimes(),
      parentEventId: null,
      // Ordered by the model's pre-save rank in creation order; nothing to set.
      eventName: mainSpecification.eventName,
      eventSlug: slugify(mainSpecification.eventName),
      description: `${mainSpecification.eventName} — demo container event.`,
      category: mainSpecification.category,
      /*
       * A container is marked solo with team sizes of 1: it holds verticals
       * rather than registrants, and the model's team rules would otherwise
       * demand a minimum roster for a level nobody registers on.
       */
      eventType: EVENT_TYPES.SOLO,
      minimumTeamSize: 1,
      maximumTeamSize: 1,
      venue: VENUES[mainIndex % VENUES.length],
      capacity: randomBetween(20, 100),
      status: mainSpecification.status,
    });
    mainEventCount += 1;
    console.log(`  Main event: ${mainEvent.eventName} → ${mainEvent._id}`);

    for (const [childIndex, childSpecification] of mainSpecification.children.entries()) {
      const isTeam = childSpecification.eventType === EVENT_TYPES.TEAM;
      const child = await EventModel.create({
        ...commonFields,
        ...buildTimes(),
        parentEventId: mainEvent._id,
        eventName: childSpecification.eventName,
        eventSlug: slugify(`${mainSpecification.eventName}-${childSpecification.eventName}`),
        description: `${childSpecification.eventName} — demo sub-event.`,
        category: mainSpecification.category,
        eventType: childSpecification.eventType,
        minimumTeamSize: isTeam ? 2 : 1,
        maximumTeamSize: isTeam ? childSpecification.maximumTeamSize : 1,
        venue: VENUES[(childIndex + mainIndex) % VENUES.length],
        capacity: randomBetween(20, 100),
        status: childSpecification.status ?? EVENT_STATUSES.PUBLISHED,
      });
      subEventCount += 1;
      console.log(`    Sub-event: ${child.eventName} → ${child._id}`);
    }
  }

  console.log("");
  console.log(`Demo fest created: ${fest._id}`);
  console.log(`Main events: ${mainEventCount}`);
  console.log(`Sub-events: ${subEventCount}`);
  console.log(`Total events: ${mainEventCount + subEventCount}`);
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
