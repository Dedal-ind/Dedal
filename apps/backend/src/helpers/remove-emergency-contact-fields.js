require("dotenv").config();

const mongoose = require("mongoose");
const { UserModel } = require("../models/user-model");

/*
 * One-off, operator-run erasure of the removed emergency contact fields
 * (emergencyContactName / emergencyContactPhone) from every user document. The
 * field was a third party's personal data, optional and only partially
 * populated — a next-of-kin list a coordinator cannot rely on is worse than
 * none — so the stored values are deliberately unset, not just hidden.
 *
 * Deliberately NOT wired into runDevelopmentMigrations(): auto-running an
 * irreversible field drop on every boot is not something anyone should be able
 * to do by accident. Run it once, on purpose:
 *   npm run migrate:remove-emergency-contact
 */
async function removeEmergencyContactFields() {
  const result = await UserModel.updateMany(
    {},
    { $unset: { emergencyContactName: "", emergencyContactPhone: "" } }
  );
  return result.modifiedCount;
}

async function main() {
  const { connectToDatabase } = require("../database/database-connection");
  let exitCode = 0;
  try {
    await connectToDatabase();
    const modifiedCount = await removeEmergencyContactFields();
    console.log(`Emergency contact fields removed from ${modifiedCount} user document(s).`);
  } catch (error) {
    console.error(`Erasure failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { removeEmergencyContactFields };
