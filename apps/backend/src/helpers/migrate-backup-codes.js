require("dotenv").config();

const mongoose = require("mongoose");
const { PassModel } = require("../models/pass-model");
const { generateBackupCode } = require("./generate-backup-code");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const BACKFILL_MAXIMUM_ATTEMPTS = 20;

/*
 * Passes minted before the backupCode field existed carry no code. Each is given
 * one, retrying on the unique-index collision the same way a fresh pass does.
 * Assumes an active connection so it can be called both at boot and standalone.
 * Idempotent: a pass that already has a code is not matched, so a second run
 * backfills nothing.
 */
async function backfillOnePass(passDocument) {
  for (let attempt = 1; attempt <= BACKFILL_MAXIMUM_ATTEMPTS; attempt += 1) {
    passDocument.backupCode = generateBackupCode();
    try {
      await passDocument.save();
      return true;
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
        throw error;
      }
    }
  }
  return false;
}

async function migrateBackupCodes() {
  const passesMissingCode = await PassModel.find({ backupCode: { $exists: false } });

  let backfilledCount = 0;
  for (const passDocument of passesMissingCode) {
    if (await backfillOnePass(passDocument)) {
      backfilledCount += 1;
    }
  }
  return backfilledCount;
}

/*
 * Standalone entry point for `npm run migrate:backup-codes`. In development the
 * same function also runs at boot from database-connection; in production this
 * script is the documented way to run it, since the boot-time path is gated off.
 */
async function main() {
  const { connectToDatabase } = require("../database/database-connection");
  let exitCode = 0;
  try {
    await connectToDatabase();
    const backfilledCount = await migrateBackupCodes();
    console.log(`Backup codes backfilled: ${backfilledCount}`);
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

module.exports = { migrateBackupCodes };
