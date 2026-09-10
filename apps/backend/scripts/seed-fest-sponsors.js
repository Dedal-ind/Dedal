// seed-fest-sponsors.js
// Sponsor logos on HALF the fests seeded by seed-discover-feed.js, so the
// sponsor treatment on the Discover card can be looked at against real content
// instead of one hand-edited row.
//
// This is a DEVELOPMENT fixture. Half is the point, not a shortcut: the card
// must collapse the sponsor strip to zero height when a fest has none, and that
// is only visible when a sponsored card and an unsponsored one sit next to each
// other in the same grid. So every OTHER seeded fest, by sorted slug, gets
// sponsors and the rest are deliberately left empty.
//
// What it writes, and why it looks like this:
//
//   · one to three sponsors per sponsored fest, so the strip is exercised at
//     every width it can be asked to render
//   · the FIRST entry is the primary — it is the one the card shows — so the
//     brands are rotated such that the primary differs from card to card
//   · real student-facing brand names (Ather, Zomato, boAt, Cred, Swiggy,
//     Redbull, Sprite, Paytm, Decathlon), because a logo strip reading
//     "Sponsor 1 / Sponsor 2" tells you nothing about how the real one will sit
//   · a stable image per brand — same seed, same picture on every reload, which
//     matters when you are comparing two screenshots of the same feed
//
//   The images were MEANT to be https://logo.clearbit.com/<domain>. Every one
//   of those nine URLs was checked before this file was written and none of
//   them resolve any more: logo.clearbit.com has no A record at all, the API
//   having been retired. A broken <img> is worse than a placeholder for
//   reviewing a layout, so all nine fall back to picsum.photos at the strip's
//   own aspect ratio (200x80), which was checked the same way and returns
//   200 image/jpeg.
//
// Safe by design, the same contract as seed-discover-feed.js:
//   · INSERT-ONLY in spirit: it writes the sponsors array and nothing else, and
//     it creates and deletes no documents.
//   · IDEMPOTENT. A fest that already has a non-empty sponsors array is skipped
//     untouched, so a rerun is a no-op and a sponsor added by hand in the admin
//     console is never overwritten.
//   · Scoped to the `seed-` slug prefix. It cannot touch a real fest.
//
// Undo with: npm run seed:discover:remove  (which clears the sponsors array on
// every seeded fest as well as deleting the seeded rows).
//
// Run with: npm run seed:sponsors

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");

/* The same marker seed-discover-feed.js writes; nothing without it is read. */
const SEED_SLUG_PREFIX = "seed-";

/*
 * The intended Clearbit domain is kept beside each brand even though nothing
 * reads it: when the logo source is replaced, this is the list to replace it
 * from, and losing it would mean guessing "boat-lifestyle.com" a second time.
 */
const BRANDS = [
  { sponsorName: "Ather", domain: "ather.com", art: "ather", linkUrl: "https://www.atherenergy.com" },
  { sponsorName: "Zomato", domain: "zomato.com", art: "zomato", linkUrl: "https://www.zomato.com" },
  { sponsorName: "boAt", domain: "boat-lifestyle.com", art: "boat", linkUrl: "https://www.boat-lifestyle.com" },
  { sponsorName: "Cred", domain: "cred.club", art: "cred", linkUrl: "https://cred.club" },
  { sponsorName: "Swiggy", domain: "swiggy.com", art: "swiggy", linkUrl: "https://www.swiggy.com" },
  { sponsorName: "Redbull", domain: "redbull.com", art: "redbull", linkUrl: "https://www.redbull.com" },
  { sponsorName: "Sprite", domain: "sprite.com", art: "sprite", linkUrl: "https://www.sprite.com" },
  { sponsorName: "Paytm", domain: "paytm.com", art: "paytm", linkUrl: "https://paytm.com" },
  { sponsorName: "Decathlon", domain: "decathlon.in", art: "decathlon", linkUrl: "https://www.decathlon.in" },
];

/* Strip proportions, not a square: a wordmark in a square box is letterboxed,
   and the review is about how the strip sits, not how the crop looks. */
const logo = (art) => `https://picsum.photos/seed/${art}/200/80`;

function sponsorFor(brandIndex) {
  const brand = BRANDS[brandIndex % BRANDS.length];
  return {
    imageUrl: logo(brand.art),
    sponsorName: brand.sponsorName,
    linkUrl: brand.linkUrl,
  };
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

async function seedFestSponsors() {
  if (!process.env.DATABASE_URI) {
    throw new Error("DATABASE_URI is not set.");
  }
  await connectLikeTheApp(process.env.DATABASE_URI);
  console.log(`Connected to database "${mongoose.connection.db.databaseName}".`);

  /* Sorted by slug, so which fests are sponsored is a property of the data and
     not of the order Mongo happened to return rows in. Rerunning after adding a
     fest may shift the alternation, which is fine: it is a fixture, and the
     already-sponsored fests are skipped rather than rewritten. */
  const seededFests = await FestModel.find({
    festSlug: { $regex: `^${SEED_SLUG_PREFIX}` },
  })
    .sort({ festSlug: 1 })
    .select("festName festSlug sponsors");

  if (seededFests.length === 0) {
    throw new Error("No seeded fests found — run npm run seed:discover first.");
  }

  let sponsoredCount = 0;
  let skippedCount = 0;
  let leftEmptyCount = 0;
  let brandCursor = 0;

  for (const [index, fest] of seededFests.entries()) {
    /* Every other one. The odd ones are the control group. */
    if (index % 2 !== 0) {
      leftEmptyCount += 1;
      continue;
    }
    if ((fest.sponsors ?? []).length > 0) {
      skippedCount += 1;
      continue;
    }

    /* One, two or three, cycling — so a card with a single logo and a card with
       a full row are both on screen without a random number generator making
       the fixture different on every run. */
    const sponsorCount = (index % 3) + 1;
    const sponsors = [];
    for (let offset = 0; offset < sponsorCount; offset += 1) {
      sponsors.push(sponsorFor(brandCursor + offset));
    }
    brandCursor += sponsorCount;

    fest.sponsors = sponsors;
    await fest.save();
    sponsoredCount += 1;
    console.log(
      `Sponsored "${fest.festName}" (${fest.festSlug}) — ${sponsors.length}: ` +
        `${sponsors.map((sponsor) => sponsor.sponsorName).join(", ")} ` +
        `(primary: ${sponsors[0].sponsorName}).`
    );
  }

  console.log(
    `\nDone. ${sponsoredCount} fest(s) given sponsors, ${skippedCount} already had some, ` +
      `${leftEmptyCount} left deliberately empty out of ${seededFests.length} seeded fest(s).`
  );
}

seedFestSponsors()
  .catch((error) => {
    console.error("Sponsor seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
