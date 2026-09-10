#!/usr/bin/env node
/*
 * One-time heal: every auto-materialised event door was IN_ONLY, so no event
 * checkpoint could ever record a check-out. Flips eventEntry doors to inAndOut.
 * Run once after deploy: npm run migrate:event-doors
 */
require("dotenv").config();
const { connectToDatabase } = require("../src/database/database-connection");
const { CheckpointModel } = require("../src/models/checkpoint-model");

(async () => {
  await connectToDatabase();
  const result = await CheckpointModel.updateMany(
    { checkpointType: "eventEntry", directionMode: "inOnly" },
    { $set: { directionMode: "inAndOut" } }
  );
  console.log(`Upgraded ${result.modifiedCount} event door(s) to inAndOut.`);
  process.exit(0);
})().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
