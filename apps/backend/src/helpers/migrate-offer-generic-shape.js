require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");

/*
 * Operator-run, one-shot, IDEMPOTENT: converts every offer subdocument from the
 * old per-unit shape to the generic two-axis shape.
 *
 *   pricePerUnitPaise > 0   → isPaid true,  ratePaise = pricePerUnitPaise
 *   pricePerUnitPaise === 0 → isPaid false, ratePaise = 0
 *   requiresQuantity true   → collectsNumberOfPeople true, and the old quantity
 *                             bounds become the PEOPLE bounds (the old axis only
 *                             ever counted heads — meals, passes, seats)
 *   requiresQuantity false  → both axes false
 *
 * Days had no equivalent in the old shape, so collectsNumberOfDays is false
 * everywhere: no existing offer was ever priced per day.
 *
 * Run with: npm run migrate:offer-generic-shape
 * NOT wired into runDevelopmentMigrations — a shape change on live money data is
 * the operator's call, never a side effect of a boot.
 *
 * Re-running is safe: an offer that already carries `ratePaise` is skipped, and
 * the old fields are unset in the same update so a second pass finds nothing.
 */
function convertOffer(rawOffer) {
  const requiresQuantity = rawOffer.requiresQuantity === true;
  const pricePerUnitPaise = rawOffer.pricePerUnitPaise ?? 0;
  return {
    _id: rawOffer._id,
    offerName: rawOffer.offerName,
    offerKey: rawOffer.offerKey,
    isActive: rawOffer.isActive !== false,
    isPaid: pricePerUnitPaise > 0,
    ratePaise: pricePerUnitPaise,
    collectsNumberOfPeople: requiresQuantity,
    numberOfPeopleMinimum: requiresQuantity ? Math.max(1, rawOffer.quantityMinimum ?? 1) : 1,
    numberOfPeopleMaximum: requiresQuantity ? rawOffer.quantityMaximum ?? null : null,
    collectsNumberOfDays: false,
    numberOfDaysMinimum: 1,
    numberOfDaysMaximum: null,
    description: rawOffer.description ?? null,
  };
}

function needsConversion(rawOffer) {
  return rawOffer.ratePaise === undefined || rawOffer.pricePerUnitPaise !== undefined;
}

async function migrateCollection(collection, ownerLabel) {
  const documentsWithOffers = await collection
    .find({ "offers.0": { $exists: true } })
    .toArray();

  let convertedDocumentCount = 0;
  let convertedOfferCount = 0;
  for (const document of documentsWithOffers) {
    const staleOffers = document.offers.filter(needsConversion);
    if (staleOffers.length === 0) {
      continue;
    }
    const convertedOffers = document.offers.map((rawOffer) =>
      needsConversion(rawOffer) ? convertOffer(rawOffer) : rawOffer
    );
    await collection.updateOne({ _id: document._id }, { $set: { offers: convertedOffers } });
    convertedDocumentCount += 1;
    convertedOfferCount += staleOffers.length;
  }
  console.log(
    `${ownerLabel}: converted ${convertedOfferCount} offers across ${convertedDocumentCount} documents.`
  );
  return { convertedDocumentCount, convertedOfferCount };
}

async function migrateOfferGenericShape() {
  // Reuse an already-open connection (a test suite, or a process that booted the
  // app); only a bare script invocation opens and closes one of its own.
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const database = mongoose.connection.db;
    const festResult = await migrateCollection(database.collection("fests"), "fests");
    const eventResult = await migrateCollection(database.collection("events"), "events");
    return { festResult, eventResult };
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  migrateOfferGenericShape()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateOfferGenericShape, convertOffer };
