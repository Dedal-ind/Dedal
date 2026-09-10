require("dotenv").config();

const mongoose = require("mongoose");
const { FestModel } = require("../models/fest-model");

/*
 * One-off, operator-run backfill of the pricing fields on existing fest.offers
 * entries: pricePerUnitPaise 0 (free, today's behaviour), description null,
 * quantityMinimum 1, quantityMaximum null. Idempotent: only offers missing
 * pricePerUnitPaise are touched, so a second run converts nothing.
 * NOT wired into runDevelopmentMigrations — run once:
 *   npm run migrate:fest-offer-pricing
 */
async function migrateFestOfferPricing() {
  const rawFests = await FestModel.collection
    .find({ "offers.0": { $exists: true }, "offers.pricePerUnitPaise": { $exists: false } })
    .toArray();
  let convertedCount = 0;
  for (const rawFest of rawFests) {
    const offers = rawFest.offers.map((offer) => ({
      pricePerUnitPaise: 0,
      description: null,
      quantityMinimum: 1,
      quantityMaximum: null,
      ...offer,
    }));
    await FestModel.collection.updateOne({ _id: rawFest._id }, { $set: { offers } });
    convertedCount += 1;
  }
  return convertedCount;
}

async function main() {
  const { connectToDatabase } = require("../database/database-connection");
  let exitCode = 0;
  try {
    await connectToDatabase();
    const convertedCount = await migrateFestOfferPricing();
    console.log(`Offer pricing backfilled on ${convertedCount} fest(s).`);
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

module.exports = { migrateFestOfferPricing };
