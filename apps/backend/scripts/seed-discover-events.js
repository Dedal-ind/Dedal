// seed-discover-events.js
// Leaf events for the twenty fests seed-discover-feed.js inserts, so those
// fests actually carry categories.
//
// The gap this closes: GET /api/v1/public/fests derives each fest's
// `categories` array from its events' `category` field (see listPublicFests —
// the $addToSet on the count aggregation). The Discover screen's filter chips
// read that array. seed-discover-feed.js writes fests and no events at all, so
// twenty of the twenty-four published fests reported `categories: []` and the
// chips filtered a feed that could not answer them — tap "Dance" and twenty
// perfectly good fixtures vanish for a reason that is an artefact of the seed
// rather than of the data.
//
// So: three to eight registerable leaf events per seeded fest, every one of
// them carrying a non-null category drawn from a twelve-value rotation, offset
// per fest so the categories land spread across the feed rather than piled on
// the first few cards. Every category in the rotation ends up on several fests,
// which is the only arrangement under which the chips are worth tapping.
//
// Same contract as the two seeds it accompanies:
//   · INSERT-ONLY. It deletes nothing and updates nothing.
//   · IDEMPOTENT by (festId, eventSlug) — the collection's own unique index.
//     A rerun skips what is already there, so it cannot duplicate.
//   · Attributed to the live platformAdmin, never an invented user id.
//   · It creates no fests. A "seed-" fest that is not there yet is not its
//     problem; run npm run seed:discover first.
//
// Undo with: npm run seed:discover:remove (which removes these events too —
// they must not outlive the fests they hang off).
//
// Run with: npm run seed:discover:events

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");
const { EventModel } = require("../src/models/event-model");
const { StaffAssignmentModel } = require("../src/models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");
const {
  EVENT_TYPES,
  EVENT_STATUSES,
  EVENT_SCORING_FORMATS,
  FEE_TYPES,
} = require("../src/constants/event-constants");

/* The prefix seed-discover-feed.js stamps on every fest it writes. This script
   works on exactly those fests and no others. */
const SEED_SLUG_PREFIX = "seed-";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/* Stable artwork, same rule as the fest seed: same seed string, same picture on
   every reload, which matters when two screenshots of the feed are being
   compared. Only some events get one — the card's no-poster fallback needs to
   be on screen too. */
const poster = (name) => `https://picsum.photos/seed/${name}/1280/720`;

/*
 * One blueprint per category the chips offer. The category IS the key, so the
 * rotation below cannot accidentally mint an event whose category nothing
 * filters on.
 *
 * `fee` is in paise and drives feeType: 0 is a free event, anything positive a
 * perPerson (solo) or perTeam (team) one — the model's cross-field rule rejects
 * the two disagreeing, so they are derived together rather than typed twice.
 */
const EVENT_BLUEPRINTS = [
  {
    category: "cultural",
    eventName: "Rangmanch Street Play",
    description: "Open-air street theatre on the main quad. Bring a cause and six minutes.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 4,
    maximumTeamSize: 10,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Open Air Theatre",
    fee: 0,
    art: "cultural-streetplay",
  },
  {
    category: "technical",
    eventName: "24-Hour Hackathon",
    description: "One night, one problem statement, one working prototype by sunrise.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 2,
    maximumTeamSize: 4,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Central Computing Lab",
    fee: 30000,
    art: "technical-hackathon",
  },
  {
    category: "gaming",
    eventName: "Valorant LAN Showdown",
    description: "Five-a-side, double-header groups, single-elimination playoffs.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 5,
    maximumTeamSize: 5,
    scoringFormat: EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION,
    venue: "Gaming Arena, Block C",
    fee: 50000,
    art: "gaming-valorant",
  },
  {
    category: "literary",
    eventName: "Slam Poetry Night",
    description: "Three minutes, no props, no accompaniment. Say the thing.",
    eventType: EVENT_TYPES.SOLO,
    minimumTeamSize: 1,
    maximumTeamSize: 1,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Literary Society Hall",
    fee: 0,
    art: null,
  },
  {
    category: "sports",
    eventName: "Campus 5K Run",
    description: "A chip-timed loop of the campus perimeter. Water at every kilometre.",
    eventType: EVENT_TYPES.SOLO,
    minimumTeamSize: 1,
    maximumTeamSize: 1,
    scoringFormat: EVENT_SCORING_FORMATS.TIME_TRIAL,
    venue: "Athletics Track",
    fee: 10000,
    /* Physical, contact-adjacent: the declaration gate belongs on at least one
       seeded event or that branch of the registration form is never exercised. */
    requiresMedicalDeclaration: true,
    art: "sports-5k",
  },
  {
    category: "management",
    eventName: "Best Manager",
    description: "Three elimination rounds of case, crisis and negotiation.",
    eventType: EVENT_TYPES.SOLO,
    minimumTeamSize: 1,
    maximumTeamSize: 1,
    scoringFormat: EVENT_SCORING_FORMATS.SCORE_BASED,
    venue: "Seminar Hall 2",
    fee: 20000,
    art: null,
  },
  {
    category: "dance",
    eventName: "Group Dance Championship",
    description: "Eight minutes on stage, any form, live judging by a panel of three.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 6,
    maximumTeamSize: 16,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Main Auditorium",
    fee: 60000,
    art: "dance-championship",
  },
  {
    category: "music",
    eventName: "Battle of the Bands",
    description: "Original sets preferred, covers permitted, backline provided.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 3,
    maximumTeamSize: 8,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Amphitheatre Stage",
    fee: 45000,
    art: "music-bands",
  },
  {
    category: "quiz",
    eventName: "The General Quiz",
    description: "Written prelims, eight teams to the stage finals. Nothing is off-syllabus.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 2,
    maximumTeamSize: 3,
    scoringFormat: EVENT_SCORING_FORMATS.SCORE_BASED,
    venue: "Lecture Theatre 1",
    fee: 0,
    art: null,
  },
  {
    category: "design",
    eventName: "UI Design Sprint",
    description: "A brief at 09:00, a clickable prototype by 17:00, five minutes to defend it.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 2,
    maximumTeamSize: 3,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Design Studio",
    fee: 15000,
    art: "design-sprint",
  },
  {
    category: "robotics",
    eventName: "Robowars Arena",
    description: "Fifteen-kilogram weight class, three-minute bouts, one live arena.",
    eventType: EVENT_TYPES.TEAM,
    minimumTeamSize: 3,
    maximumTeamSize: 6,
    scoringFormat: EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION,
    venue: "Mechanical Workshop Arena",
    fee: 80000,
    requiresMedicalDeclaration: true,
    art: "robotics-robowars",
  },
  {
    category: "photography",
    eventName: "Photo Walk and Print",
    description: "A guided walk, then one frame submitted for print by the evening deadline.",
    eventType: EVENT_TYPES.SOLO,
    minimumTeamSize: 1,
    maximumTeamSize: 1,
    scoringFormat: EVENT_SCORING_FORMATS.JUDGED,
    venue: "Meet at the Main Gate",
    fee: 0,
    art: "photography-walk",
  },
];

function slugFor(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
 * database that nothing reads.
 */
async function connectLikeTheApp(uri) {
  const path = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "http:"))
    .pathname.replace(/^\//, "");
  const options = path ? {} : { dbName: "Management" };
  await mongoose.connect(uri, options);
}

/*
 * Which blueprints this fest runs.
 *
 * Count walks 3..8 with the fest's position, and the starting point of the
 * rotation strides by five through a list of twelve — five and twelve are
 * coprime, so twenty consecutive fests start at twenty well-spread points
 * rather than at four repeating ones. The effect is that every category lands
 * on several fests and no fest is a copy of its neighbour.
 */
function blueprintsForFest(festIndex) {
  const count = 3 + (festIndex % 6);
  const start = (festIndex * 5) % EVENT_BLUEPRINTS.length;
  return Array.from(
    { length: count },
    (unused, offset) => EVENT_BLUEPRINTS[(start + offset) % EVENT_BLUEPRINTS.length]
  );
}

async function seedDiscoverEvents() {
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
    throw new Error("No active platformAdmin staff assignment found — cannot attribute events.");
  }

  const fests = await FestModel.find({ festSlug: { $regex: `^${SEED_SLUG_PREFIX}` } })
    .sort({ startsOn: 1 })
    .select("_id festName festSlug startsOn endsOn")
    .lean();
  if (fests.length === 0) {
    throw new Error(
      `No fests with a "${SEED_SLUG_PREFIX}" slug found — run npm run seed:discover first.`
    );
  }

  let insertedCount = 0;
  let skippedCount = 0;

  for (const [festIndex, fest] of fests.entries()) {
    const blueprints = blueprintsForFest(festIndex);
    /* Inclusive of the start day, and never zero: a one-day fest still needs a
       modulus to spread its events over. */
    const festDays = Math.max(1, Math.round((fest.endsOn - fest.startsOn) / DAY));

    for (const [slot, blueprint] of blueprints.entries()) {
      const eventSlug = slugFor(blueprint.eventName);
      /* Keyed on (festId, eventSlug) — the collection's own unique index, so
         the skip here and the constraint below it agree by construction. */
      if (await EventModel.exists({ festId: fest._id, eventSlug })) {
        skippedCount += 1;
        continue;
      }

      /*
       * Inside the fest's own window, which the model does not enforce but the
       * fest page assumes: an event on day (slot mod festDays) at 10:00, four
       * hours long, and the whole thing clamped to end on or before the fest's
       * last moment so a five-event one-day fest cannot spill past it.
       */
      const startsAt = new Date(fest.startsOn.getTime() + (slot % festDays) * DAY + 10 * HOUR);
      const endsAt = new Date(Math.min(startsAt.getTime() + 4 * HOUR, fest.endsOn.getTime()));

      /*
       * Registration opens a fortnight before the fest — several of these fests
       * are already running, so an opens-at pinned to "now" would leave them
       * with a window that never contained the present. It closes when the
       * event ends, which is the latest the model allows (walk-up registration
       * is deliberate; see the pre-validate hook) and keeps every seeded event
       * registerable for as long as it is worth looking at.
       */
      const registrationOpensAt = new Date(fest.startsOn.getTime() - 14 * DAY);
      const registrationClosesAt = endsAt;

      const isFree = blueprint.fee === 0;
      const created = await EventModel.create({
        festId: fest._id,
        /* A LEAF, explicitly: only leaves carry a category, and only leaves are
           registerable. No grouping containers here — a vertical with no
           category would contribute nothing to the chips. */
        parentEventId: null,
        eventName: blueprint.eventName,
        eventSlug,
        description: blueprint.description,
        category: blueprint.category,
        eventType: blueprint.eventType,
        minimumTeamSize: blueprint.minimumTeamSize,
        maximumTeamSize: blueprint.maximumTeamSize,
        scoringFormat: blueprint.scoringFormat,
        venue: blueprint.venue,
        startsAt,
        endsAt,
        registrationOpensAt,
        registrationClosesAt,
        capacity: 60 + slot * 20,
        feeType: isFree
          ? FEE_TYPES.FREE
          : blueprint.eventType === EVENT_TYPES.TEAM
            ? FEE_TYPES.PER_TEAM
            : FEE_TYPES.PER_PERSON,
        feeAmountPaise: blueprint.fee,
        requiresMedicalDeclaration: blueprint.requiresMedicalDeclaration === true,
        /* Artwork on most, none on the rest, so the card's fallback is on
           screen and not just in the CSS. Seeded per fest as well as per event,
           so the same event under two fests is not the same picture. */
        posterImageUrl: blueprint.art ? poster(`${fest.festSlug}-${blueprint.art}`) : null,
        /* PUBLISHED: the public reads filter on an allow-list
           (PUBLICLY_VISIBLE_EVENT_STATUSES) that a draft is not in, and a draft
           event would leave the fest's categories array as empty as it is now. */
        status: EVENT_STATUSES.PUBLISHED,
        createdByUserId: platformAdminAssignment.userId,
        /* siblingRank is left unset on purpose: the model's pre-save hook mints
           one after the current last sibling, so these land in insertion order
           and no row is born unranked. */
      });
      insertedCount += 1;
      console.log(
        `  ${fest.festSlug} → "${created.eventName}" (${created.category}) — ${created.status}.`
      );
    }
  }

  console.log(
    `\nDone. ${insertedCount} event(s) inserted across ${fests.length} seeded fest(s), ` +
      `${skippedCount} already present.`
  );
}

seedDiscoverEvents()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
