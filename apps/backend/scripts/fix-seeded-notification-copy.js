require("dotenv").config();
const mongoose = require("mongoose");
const { NotificationModel } = require("../src/models/notification-model");

/*
 * Dev fixture cleanup: the seeded notification rows were written with em dashes
 * and instructional tails ("download it any time from My Certificates"), both of
 * which the row layout cannot afford — a dash reads as a hyphen at 13px and the
 * instruction pushed the fest name out of view. Titles under ~50 characters,
 * bodies under ~120, no dashes.
 */
const REWRITES = [
  [/^Gates open at/, { body: "Main gate opens an hour before the first event. Bring your pass or the 6 digit backup code." }],
  [/Round 1 has started$/, { body: "Report to Lab 3. Late entries are not seated once the round begins." }],
  [/^Results are out/, { body: "Final standings are published for all rounds." }],
  [/certificate is ready$/, { body: "Demo Fest 2027. Open it from My certificates." }],
  [/^Parking has moved/, { body: "Gate A is closed for the main stage build. Allow ten extra minutes." }],
];

(async () => {
  await mongoose.connect(process.env.DATABASE_URI, { dbName: "festAppMvp" });
  const rows = await NotificationModel.find({});
  let changed = 0;
  for (const row of rows) {
    const rule = REWRITES.find(([pattern]) => pattern.test(row.title));
    const nextBody = rule ? rule[1].body : (row.body ?? "").replace(/\s*[—–]\s*/g, ", ");
    const nextTitle = row.title.replace(/\s*[—–]\s*/g, ", ");
    if (nextBody !== row.body || nextTitle !== row.title) {
      row.body = nextBody;
      row.title = nextTitle;
      await row.save();
      changed += 1;
      console.log(`${row.title}\n   ${row.body}\n`);
    }
  }
  console.log(`${changed} notification(s) rewritten.`);
  await mongoose.disconnect();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
