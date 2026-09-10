require("dotenv").config();

const mongoose = require("mongoose");
const { connectToDatabase } = require("../database/database-connection");

/*
 * One-off. Reshapes college documents written before PRODUCT-SPEC 5.2 field
 * names landed: `name` becomes collegeName and commonName, `isActive` becomes
 * isVerified, and the optional spec fields are materialised as null.
 *
 * This runs as an aggregation-pipeline update through the raw driver, not
 * through Mongoose. A read-modify-write would hydrate the old document against
 * the NEW schema, whose `commonName` is required, and fail validation before it
 * ever had the chance to supply the field. The pipeline also makes the whole
 * reshape one atomic server-side operation per document.
 *
 * Idempotent: the filter matches only documents that still carry `name`, so a
 * second run matches nothing.
 */
async function migrateCollegeFields() {
  await connectToDatabase();

  const collegesCollection = mongoose.connection.db.collection("colleges");

  const result = await collegesCollection.updateMany({ name: { $exists: true } }, [
    {
      $set: {
        collegeName: "$name",
        commonName: { $ifNull: ["$commonName", "$name"] },
        isVerified: { $ifNull: ["$isActive", true] },
        usnPrefix: { $ifNull: ["$usnPrefix", null] },
        logoUrl: { $ifNull: ["$logoUrl", null] },
        contactEmail: { $ifNull: ["$contactEmail", null] },
        createdByUserId: { $ifNull: ["$createdByUserId", null] },
      },
    },
    { $unset: ["name", "isActive"] },
  ]);

  console.log(`Colleges matched:  ${result.matchedCount}`);
  console.log(`Colleges migrated: ${result.modifiedCount}`);

  if (result.matchedCount === 0) {
    console.log("Nothing to migrate — no college carries the legacy `name` field.");
  }

  console.log("Migration complete.");

  // Drain the microtask queue so the lines above flush before process.exit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  let exitCode = 0;
  try {
    await migrateCollegeFields();
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
