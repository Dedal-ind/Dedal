require("dotenv").config();

const mongoose = require("mongoose");
const { FestModel } = require("../models/fest-model");
const { RESERVED_OFFER_KEYS } = require("../constants/fest-constants");

/*
 * One-off, operator-run conversion of the old offersFood/offersAccommodation
 * booleans into the admin-defined `offers` array:
 *   offersFood true          → { offerName: "Food", offerKey: "food", requiresQuantity: true }
 *   offersAccommodation true → { offerName: "Accommodation", offerKey: "accommodation" }
 * then $unset both booleans. Idempotent: an offer whose key already exists is
 * never pushed again, and a fest without the raw booleans is skipped, so a
 * second run converts nothing.
 *
 * Deliberately NOT wired into runDevelopmentMigrations(); run it once:
 *   npm run migrate:fest-offers
 */
async function migrateFestOffers() {
  // The booleans are gone from the schema, so read them raw.
  const rawFests = await FestModel.collection
    .find({ $or: [{ offersFood: { $exists: true } }, { offersAccommodation: { $exists: true } }] })
    .toArray();

  let convertedCount = 0;
  for (const rawFest of rawFests) {
    const existingKeys = new Set((rawFest.offers ?? []).map((offer) => offer.offerKey));
    const offersToPush = [];
    if (rawFest.offersFood === true && !existingKeys.has(RESERVED_OFFER_KEYS.FOOD)) {
      offersToPush.push({
        _id: new mongoose.Types.ObjectId(),
        offerName: "Food",
        offerKey: RESERVED_OFFER_KEYS.FOOD,
        requiresQuantity: true,
        isActive: true,
      });
    }
    if (
      rawFest.offersAccommodation === true &&
      !existingKeys.has(RESERVED_OFFER_KEYS.ACCOMMODATION)
    ) {
      offersToPush.push({
        _id: new mongoose.Types.ObjectId(),
        offerName: "Accommodation",
        offerKey: RESERVED_OFFER_KEYS.ACCOMMODATION,
        requiresQuantity: false,
        isActive: true,
      });
    }

    const updateOperations = { $unset: { offersFood: "", offersAccommodation: "" } };
    if (offersToPush.length > 0) {
      updateOperations.$push = { offers: { $each: offersToPush } };
    }
    await FestModel.collection.updateOne({ _id: rawFest._id }, updateOperations);
    convertedCount += 1;
  }
  return convertedCount;
}

async function main() {
  const { connectToDatabase } = require("../database/database-connection");
  let exitCode = 0;
  try {
    await connectToDatabase();
    const convertedCount = await migrateFestOffers();
    console.log(`Fest offers migrated: ${convertedCount} fest(s) converted.`);
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { migrateFestOffers };
