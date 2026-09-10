const mongoose = require("mongoose");
const { applicationConfig } = require("../config/application-config");
const { databaseConnectOptions } = require("../config/database-config");

/*
 * In development the backup-code backfill runs automatically after connect, so a
 * database seeded before the field existed becomes scannable without a manual
 * step. In production the boot path is gated off and the migration is run
 * deliberately via `npm run migrate:backup-codes`. The require is lazy to avoid a
 * cycle: the migration module reaches back for connectToDatabase when run
 * standalone.
 */
async function runDevelopmentMigrations() {
  if (!applicationConfig.isDevelopment) {
    return;
  }
  const { migrateBackupCodes } = require("../helpers/migrate-backup-codes");
  const backfilledCount = await migrateBackupCodes();
  console.log(`Backup-code migration: ${backfilledCount} pass(es) backfilled.`);
}

async function connectToDatabase() {
  await mongoose.connect(applicationConfig.databaseUri, databaseConnectOptions);
  console.log("Database connected");
  await runDevelopmentMigrations();
}

module.exports = { connectToDatabase };
