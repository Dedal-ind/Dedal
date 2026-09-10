// seed-promotions.js
// One-time seeding of home-screen promotion banners. The Discover carousel
// hides itself (correctly) when GET /public/promotions returns empty arrays;
// this puts three PUBLISHED commercial banners in the promotions collection so
// the carousel has something real to show.
//
// Safe by design:
//   · INSERT-ONLY — touches nothing else, deletes nothing.
//   · IDEMPOTENT — refuses to run if any promotion already exists, so a rerun
//     cannot duplicate banners in front of every participant.
//   · createdByUserId is resolved from the LIVE platformAdmin staff assignment
//     (the model requires a real user; promotions are platform-admin-only).
//
// Run with: npm run seed:promotions

require("dotenv").config();

const mongoose = require("mongoose");

const {
  PromotionModel,
  PROMOTION_STATUSES,
  PROMOTION_TYPES,
} = require("../src/models/promotion-model");
const { StaffAssignmentModel } = require("../src/models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");

// Stable placeholder artwork; publicly reachable, and the frontend's own
// gradient fallback covers an offline dev box.
const PROMOTIONS_TO_SEED = [
  {
    title: "Power Your Passion",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    imageUrl: "https://picsum.photos/800/400?random=1",
    linkUrl: null,
    description: "Student discounts on laptops and audio, all fest week.",
    displayOrder: 1,
  },
  {
    title: "Fuel the Fest",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    imageUrl: "https://picsum.photos/800/400?random=2",
    linkUrl: null,
    description: "Meal combos at every campus counter.",
    displayOrder: 2,
  },
  {
    title: "Campus Merch Drop",
    promotionType: PROMOTION_TYPES.COMMERCIAL,
    imageUrl: "https://picsum.photos/800/400?random=3",
    linkUrl: null,
    description: "Limited fest-edition merchandise, while stocks last.",
    displayOrder: 3,
  },
];

async function seedPromotions() {
  if (!process.env.DATABASE_URI) {
    throw new Error("DATABASE_URI is not set.");
  }

  /*
   * dbName pinned EXPLICITLY: the DATABASE_URI in .env carries no database
   * path, so a bare connect lands on "test" — which is empty. The application
   * data lives in "Management" on this cluster; the deployed API reads from
   * it, so the seed must write there for the carousel to see the rows.
   */
  await mongoose.connect(process.env.DATABASE_URI, { dbName: "Management" });
  console.log(`Connected to database "${mongoose.connection.db.databaseName}".`);

  const existingCount = await PromotionModel.countDocuments();
  if (existingCount > 0) {
    console.log(
      `Refusing to seed: ${existingCount} promotion(s) already exist. ` +
        "Manage them through the platform-admin endpoints instead."
    );
    return;
  }

  // The model requires a real creator, and promotions are platform-admin-only —
  // attribute the rows to the live platform admin, never an invented id.
  const platformAdminAssignment = await StaffAssignmentModel.findOne({
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId")
    .lean();
  if (!platformAdminAssignment) {
    throw new Error("No active platformAdmin staff assignment found — cannot attribute promotions.");
  }

  const publishedAt = new Date();
  for (const promotion of PROMOTIONS_TO_SEED) {
    const created = await PromotionModel.create({
      ...promotion,
      status: PROMOTION_STATUSES.PUBLISHED,
      publishedAt,
      createdByUserId: platformAdminAssignment.userId,
    });
    console.log(
      `Inserted ${created.promotionType} promotion "${created.title}" (${created.id}) — ${created.status}.`
    );
  }
  console.log(`Seeded ${PROMOTIONS_TO_SEED.length} published promotions.`);
}

seedPromotions()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
