require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");

/*
 * Operator-run, IDEMPOTENT unwind of the coordinator offer-scoping experiment.
 *
 * StaffAssignment briefly carried an `offerIds` array so a COORDINATOR could be
 * narrowed to particular offers. The client has since ruled that out — "for
 * offers, only volunteers need scan access" — so the field is gone from the
 * schema and every reader. Rows that acquired it (only possible in the window
 * since that change landed) simply have it unset; nothing else about the
 * assignment changes, and no assignment loses coverage — dropping the narrowing
 * can only widen, and coordinators are event-scoped again either way.
 *
 * Run with: npm run migrate:remove-assignment-offer-ids
 */
async function migrateRemoveAssignmentOfferIds() {
  // Reuse an already-open connection; only a bare script invocation opens one.
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const result = await mongoose.connection.db
      .collection("staffAssignments")
      .updateMany({ offerIds: { $exists: true } }, { $unset: { offerIds: "" } });
    console.log(`staffAssignments: unset offerIds on ${result.modifiedCount} rows.`);
    return { modifiedCount: result.modifiedCount };
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  migrateRemoveAssignmentOfferIds()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateRemoveAssignmentOfferIds };
