// seed-discover-feed.js
// Twenty published fests and four published promotions, so the Discover feed
// can be looked at with realistic content instead of two rows and a gradient.
//
// This is a DEVELOPMENT fixture. It exists to make the redesigned feed
// reviewable — long enough to scroll, varied enough to exercise every branch
// the card has:
//
//   · live now, starting this week, starting next month, months out
//   · a banner image on most, and none at all on two, so the --accent fallback
//     wash is on screen and not just in the CSS
//   · one fest with a video banner, so autoplay-on-scroll is exercised
//   · a registration deadline inside the seven-day horizon on three of them,
//     and outside it on the rest, so "Closes in 3 days" appears on some cards
//     and is correctly absent from the others
//   · long names, short names, and one name long enough to hit the title's
//     two-line clamp
//
// Safe by design, the same contract as seed-promotions.js:
//   · INSERT-ONLY. It deletes nothing and updates nothing.
//   · IDEMPOTENT by slug. Every fest carries a `seed-` slug prefix; a rerun
//     skips any slug already present, so it cannot duplicate.
//   · Attributed to the live platformAdmin, never an invented user id.
//   · Hosted by colleges that already exist. It creates no colleges.
//
// Undo with: npm run seed:discover:remove
//
// Run with: npm run seed:discover

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");
const { CollegeModel } = require("../src/models/college-model");
const {
  PromotionModel,
  PROMOTION_STATUSES,
  PROMOTION_TYPES,
  PROMOTION_MEDIA_TYPES,
} = require("../src/models/promotion-model");
const { StaffAssignmentModel } = require("../src/models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");
const { FEST_VISIBILITIES, FEST_STATUSES } = require("../src/constants/fest-constants");

/* Every row this script writes carries it, so the remover can find them all
   and nothing hand-made is ever caught by the cleanup. */
const SEED_SLUG_PREFIX = "seed-";

const DAY = 24 * 60 * 60 * 1000;

/* A stable image per fest — same seed, same picture on every reload, which
   matters when you are comparing two screenshots of the same feed. */
const poster = (name) => `https://picsum.photos/seed/${name}/1280/720`;

/*
 * daysFromNow is the START offset; a negative one is a fest already running.
 * durationDays is inclusive of the start day.
 * closesInDays is the registration deadline offset, or null for no deadline.
 */
const FESTS_TO_SEED = [
  { name: "Mood Indigo", days: -1, duration: 4, closes: null, art: "moodindigo" },
  { name: "Riviera", days: 0, duration: 3, closes: null, art: "riviera" },
  { name: "Saarang", days: 2, duration: 5, closes: 1, art: "saarang" },
  { name: "Antaragni", days: 4, duration: 3, closes: 3, art: "antaragni" },
  { name: "Rendezvous", days: 6, duration: 4, closes: 5, art: "rendezvous" },
  { name: "Oasis", days: 9, duration: 4, closes: 8, art: "oasis" },
  { name: "Waves", days: 12, duration: 3, closes: 10, art: "waves" },
  { name: "Techfest", days: 15, duration: 3, closes: null, art: "techfest" },
  /* No artwork: the accent fallback wash. */
  { name: "Alcheringa", days: 18, duration: 4, closes: null, art: null },
  { name: "Spring Fest", days: 22, duration: 3, closes: null, art: "springfest" },
  /* Video banner: exercises autoplay, pause and the progress rule. */
  {
    name: "Kashiyatra",
    days: 25,
    duration: 3,
    closes: null,
    art: "kashiyatra",
    video: "https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files@master/big_buck_bunny.mp4",
  },
  { name: "Unmad", days: 28, duration: 2, closes: null, art: "unmad" },
  { name: "Thomso", days: 33, duration: 4, closes: null, art: "thomso" },
  { name: "Elysium", days: 38, duration: 3, closes: null, art: "elysium" },
  {
    name: "Vidyut National Techno-Management Festival",
    days: 44,
    duration: 5,
    closes: null,
    art: "vidyut",
  },
  { name: "Nihilanth", days: 51, duration: 2, closes: null, art: "nihilanth" },
  /* No artwork, second instance. */
  { name: "Blithchron", days: 58, duration: 3, closes: null, art: null },
  { name: "Zephyr", days: 66, duration: 3, closes: null, art: "zephyr" },
  { name: "Concetto", days: 75, duration: 4, closes: null, art: "concetto" },
  { name: "Aavartan", days: 90, duration: 3, closes: null, art: "aavartan" },
];

const PROMOTIONS_TO_SEED = [
  {
    title: "Ather 450X campus test rides",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    mediaType: PROMOTION_MEDIA_TYPES.IMAGE,
    imageUrl: poster("ather"),
    linkUrl: "https://example.com/ather",
    description: "Book a slot, ride it around the quad.",
    displayOrder: 1,
  },
  {
    title: "Zomato for Students",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    mediaType: PROMOTION_MEDIA_TYPES.IMAGE,
    imageUrl: poster("zomato"),
    linkUrl: "https://example.com/zomato",
    description: "Flat 40% off through fest week.",
    displayOrder: 2,
  },
  {
    title: "Boat Airdopes on campus",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    mediaType: PROMOTION_MEDIA_TYPES.IMAGE,
    imageUrl: poster("boat"),
    linkUrl: "https://example.com/boat",
    description: "Student pricing at the merch counter.",
    displayOrder: 3,
  },
  {
    title: "NIT Trichy Festember",
    promotionType: PROMOTION_TYPES.COLLEGE_EVENT,
    mediaType: PROMOTION_MEDIA_TYPES.IMAGE,
    imageUrl: poster("festember"),
    linkUrl: "https://example.com/festember",
    description: "Registrations close this Sunday.",
    collegeName: "NIT Tiruchirappalli",
    displayOrder: 4,
  },
];

function slugFor(name) {
  return (
    SEED_SLUG_PREFIX +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/*
 * Connect exactly the way the application does: honour the database named in
 * the URI's own path, and only fall back to an explicit name when the URI has
 * none.
 *
 * This is not a stylistic preference. seed-promotions.js pins dbName to
 * "Management" unconditionally, which is right for the deployed cluster whose
 * URI carries no path and wrong for local development, where the URI ends in
 * /festAppMvp. Pinning there silently redirects every write into an empty
 * database that nothing reads — which is exactly what happened on the first
 * run of this script: it connected, found no users, and reported no platform
 * admin on a machine that has several.
 */
async function connectLikeTheApp(uri) {
  const path = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "http:"))
    .pathname.replace(/^\//, "");
  const options = path ? {} : { dbName: "Management" };
  await mongoose.connect(uri, options);
}

async function seedDiscoverFeed() {
  if (!process.env.DATABASE_URI) {
    throw new Error("DATABASE_URI is not set.");
  }
  await connectLikeTheApp(process.env.DATABASE_URI);
  console.log(`Connected to database "${mongoose.connection.db.databaseName}".`);

  const platformAdminAssignment = await StaffAssignmentModel.findOne({
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId")
    .lean();
  if (!platformAdminAssignment) {
    throw new Error("No active platformAdmin staff assignment found — cannot attribute fests.");
  }

  /* Hosts are drawn from the colleges that already exist, cycled. This script
     creates no colleges: an invented one would show up in the college picker,
     the admin console and the onboarding flow long after the seed was
     forgotten about. */
  const colleges = await CollegeModel.find({}).select("_id commonName").limit(10).lean();
  if (colleges.length === 0) {
    throw new Error("No colleges found — seed a college before seeding the Discover feed.");
  }

  const now = Date.now();
  let insertedCount = 0;
  let skippedCount = 0;

  for (const [index, entry] of FESTS_TO_SEED.entries()) {
    const festSlug = slugFor(entry.name);
    if (await FestModel.exists({ festSlug })) {
      skippedCount += 1;
      continue;
    }
    const host = colleges[index % colleges.length];
    const startsOn = new Date(now + entry.days * DAY);
    const endsOn = new Date(now + (entry.days + entry.duration) * DAY);

    const created = await FestModel.create({
      festName: entry.name,
      festSlug,
      hostCollegeId: host._id,
      description: `${entry.name}, hosted by ${host.commonName}.`,
      startsOn,
      endsOn,
      /* PUBLIC, not interCollege: an interCollege fest requires a non-empty
         allowedCollegeIds list, and inventing an allow-list would make these
         fixtures invisible to most seeded participants for a reason that has
         nothing to do with what they are for. */
      visibility: FEST_VISIBILITIES.PUBLIC,
      status: FEST_STATUSES.PUBLISHED,
      bannerImageUrl: entry.art ? poster(entry.art) : null,
      contactEmail: "fest@example.edu.in",
      createdByUserId: platformAdminAssignment.userId,
      /*
       * These two are NOT in the fest schema — the model strips them on save.
       * They are set anyway and reported below so it is obvious from the seed
       * output that the fest-level video and deadline the redesigned card can
       * render have no column to be stored in yet. See the note in the report.
       */
      bannerVideoUrl: entry.video ?? null,
      registrationClosesAt: entry.closes === null ? null : new Date(now + entry.closes * DAY),
    });
    insertedCount += 1;
    console.log(`Inserted fest "${created.festName}" (${created.festSlug}) — ${created.status}.`);
  }

  let promotionsInserted = 0;
  for (const promotion of PROMOTIONS_TO_SEED) {
    if (await PromotionModel.exists({ title: promotion.title })) {
      continue;
    }
    await PromotionModel.create({
      ...promotion,
      status: PROMOTION_STATUSES.PUBLISHED,
      publishedAt: new Date(),
      createdByUserId: platformAdminAssignment.userId,
    });
    promotionsInserted += 1;
    console.log(`Inserted ${promotion.promotionType} promotion "${promotion.title}".`);
  }

  console.log(
    `\nDone. ${insertedCount} fest(s) inserted, ${skippedCount} already present. ` +
      `${promotionsInserted} promotion(s) inserted.`
  );
}

seedDiscoverFeed()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
