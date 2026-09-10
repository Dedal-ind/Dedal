// remove-discover-feed-seed.js
// Undoes seed-discover-feed.js AND seed-discover-events.js, and nothing else.
//
// It deletes ONLY fests whose slug carries the seed prefix, ONLY the events
// hanging off those fests, and ONLY promotions whose title is one of the four
// the seed writes. A hand-made fest cannot be caught by it, because a hand-made
// fest does not have a "seed-" slug — that prefix exists for exactly this
// reason.
//
// The events go FIRST and are selected by festId, not by any marker of their
// own. They have no slug prefix to key on — an event's slug is derived from its
// name, the same way a real one's is — so the seed prefix on the PARENT is the
// only thing that identifies them, and once the fests are gone there is nothing
// left to identify them by. Deleting the fest and leaving its events behind
// would orphan rows that reference a festId nothing can resolve, which the fest
// page, the search index and the next run of the seed all read.
//
// It also undoes seed-fest-sponsors.js, by clearing the sponsors array on every
// seeded fest BEFORE the fests themselves are deleted. Deleting the fest would
// of course take its embedded sponsors with it, so on a full run the clear is
// redundant — it is here so that the clear is reported separately and so that a
// run which cannot delete a fest (a foreign reference, a future guard) still
// leaves no seeded sponsor logo on a participant's screen. Sponsors are cleared
// on ALL seeded fests, not only the ones the sponsor seed wrote, for the same
// reason the fests are matched by prefix rather than by a list of names.
//
// It refuses to run against a database whose URI does not look local unless
// ALLOW_REMOTE_SEED_REMOVAL=1 is set. A cleanup script is the one kind of
// script that must be hard to point at production by accident.
//
// Run with: npm run seed:discover:remove

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");
const { EventModel } = require("../src/models/event-model");
const { PromotionModel } = require("../src/models/promotion-model");

const SEED_SLUG_PREFIX = "seed-";

const SEEDED_PROMOTION_TITLES = [
  "Ather 450X campus test rides",
  "Zomato for Students",
  "Boat Airdopes on campus",
  "NIT Trichy Festember",
];

function looksLocal(uri) {
  return /localhost|127\.0\.0\.1|mongodb:\/\/mongo\b/.test(uri);
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

async function removeSeed() {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    throw new Error("DATABASE_URI is not set.");
  }
  if (!looksLocal(uri) && process.env.ALLOW_REMOTE_SEED_REMOVAL !== "1") {
    throw new Error(
      "DATABASE_URI does not look local. Re-run with ALLOW_REMOTE_SEED_REMOVAL=1 if that is genuinely what you want."
    );
  }

  await connectLikeTheApp(uri);
  console.log(`Connected to database "${mongoose.connection.db.databaseName}".`);

  /* Resolved before anything is deleted: the ids are the only handle the events
     have, and deleting the fests first would throw it away. */
  const seededFestIds = await FestModel.distinct("_id", {
    festSlug: { $regex: `^${SEED_SLUG_PREFIX}` },
  });

  const sponsorResult = await FestModel.updateMany(
    { _id: { $in: seededFestIds }, "sponsors.0": { $exists: true } },
    { $set: { sponsors: [] } }
  );

  const eventResult = await EventModel.deleteMany({ festId: { $in: seededFestIds } });
  const festResult = await FestModel.deleteMany({ _id: { $in: seededFestIds } });
  const promotionResult = await PromotionModel.deleteMany({
    title: { $in: SEEDED_PROMOTION_TITLES },
  });

  console.log(
    `Cleared sponsors on ${sponsorResult.modifiedCount} seeded fest(s).`
  );
  console.log(
    `Removed ${eventResult.deletedCount} seeded event(s), ${festResult.deletedCount} seeded fest(s) ` +
      `and ${promotionResult.deletedCount} seeded promotion(s).`
  );
}

removeSeed()
  .catch((error) => {
    console.error("Removal failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
