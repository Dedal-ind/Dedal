const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { CollegeModel } = require("../models/college-model");

/*
 * Backfills the structured address onto colleges created before it existed —
 * chiefly the seeded reference directory, which has a name, a city and a state
 * and nothing more.
 *
 * The PIN is the sentinel "000000", which DELIBERATELY fails the
 * ^[1-9]\d{5}$ rule the validator enforces. That is the point: a backfilled
 * address is a placeholder, not a fact, and the sentinel guarantees the college
 * cannot save any later edit without supplying a real PIN. Do NOT relax the
 * regex to accept 0-prefixed PINs to "fix" these rows — that would silently
 * bless every placeholder as verified data.
 *
 * district uses an em dash for the same reason: it is visibly not an answer.
 *
 * Reference-directory colleges have no administrator to correct them, and that
 * is fine — their address is never shown to participants (CollegeSelect reads
 * collegeName, city and state only). The sentinel simply waits until such a
 * college is claimed and becomes an active tenant.
 *
 * Written with updateOne rather than save() on purpose: save() would run the
 * subdocument's required/match validators and reject the very sentinel this
 * migration exists to plant.
 */
const SENTINEL_PIN_CODE = "000000";
const SENTINEL_DISTRICT = "—";

async function migrateCollegeAddress() {
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }

  const collegesWithoutAddress = await CollegeModel.find({
    $or: [{ address: { $exists: false } }, { address: null }],
  })
    .select("collegeName city state")
    .lean();

  let convertedCount = 0;
  for (const college of collegesWithoutAddress) {
    await CollegeModel.updateOne(
      { _id: college._id },
      {
        $set: {
          address: {
            // The full name is the best guess available for a street line.
            addressLine1: college.collegeName,
            addressLine2: null,
            addressLine3: null,
            addressLine4: null,
            city: college.city,
            townOrLocality: null,
            district: SENTINEL_DISTRICT,
            state: college.state,
            pinCode: SENTINEL_PIN_CODE,
            country: "India",
          },
        },
      }
    );
    convertedCount += 1;
  }

  console.log(
    `College address migration: ${convertedCount} college(s) backfilled with the placeholder address ` +
      `(PIN ${SENTINEL_PIN_CODE} — intentionally invalid until the college supplies a real one).`
  );

  if (ownsConnection) {
    await mongoose.disconnect();
  }
  return { convertedCount };
}

if (require.main === module) {
  migrateCollegeAddress()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`College address migration failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { migrateCollegeAddress, SENTINEL_PIN_CODE, SENTINEL_DISTRICT };
