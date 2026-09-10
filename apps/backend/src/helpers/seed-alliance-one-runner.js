/*
 * Runner for the Alliance ONE 2026 seed: opens a database connection, runs the
 * seed, and exits. `npm run seed`.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { connectToDatabase } = require("../database/database-connection");
const { seedAllianceOne } = require("./seed-alliance-one");

async function main() {
  let exitCode = 0;
  try {
    await connectToDatabase();
    await seedAllianceOne();
  } catch (error) {
    console.error(`Alliance ONE seed failed: ${error.message}`);
    console.error(error.stack);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  // Let stdout flush before process.exit, which does not wait for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exit(exitCode);
}

main();
