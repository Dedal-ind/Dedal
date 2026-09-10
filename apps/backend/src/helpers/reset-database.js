require("dotenv").config();

const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");

/*
 * Destructive: drops every collection in the connected database. Gated hard to
 * development — a stray `npm run db:reset` against a production URI must throw
 * before touching anything. Collections are dropped (not the database), so the
 * DB name and connection URI stay valid for the app that reconnects afterwards.
 */
async function resetDatabase() {
  if (!applicationConfig.isDevelopment) {
    throw new Error(
      "db:reset refuses to run: APPLICATION_ENVIRONMENT must be 'development' to wipe the database."
    );
  }

  await connectToDatabase();

  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const { name } of collections) {
    await mongoose.connection.db.dropCollection(name);
    console.log(`Dropped collection: ${name}`);
  }

  console.log(`Reset complete: ${collections.length} collection(s) dropped.`);
}

async function main() {
  let exitCode = 0;
  try {
    await resetDatabase();
  } catch (error) {
    console.error(`Reset failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  // Let stdout flush before process.exit, which does not wait for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exit(exitCode);
}

main();
