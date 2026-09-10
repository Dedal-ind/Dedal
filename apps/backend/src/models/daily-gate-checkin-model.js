const mongoose = require("mongoose");

/*
 * One person's FIRST crossing of the Main Gate on one calendar day.
 *
 * WHY THIS EXISTS AT ALL, given entitlements already gate the door. The
 * gateAccess entitlement is unlimited (maximumUses null) because a participant
 * walks in and out of campus all day and none of that should ever be refused.
 * That makes the entitlement useless as a record of ATTENDANCE: usedCount counts
 * crossings, not days, and nothing in it can answer "is this person on campus
 * today", which is the question every event door and offer counter now asks
 * before it opens.
 *
 * So this is the attendance layer sitting on top of the entitlement layer. The
 * entitlement decides whether the gate may open; this records that it did, once
 * per day, and everything inside the campus reads it.
 *
 * ONE ROW PER PASS PER DAY, enforced by the unique index below rather than by a
 * read-then-write in the service. Two volunteers scanning the same person at two
 * gate lanes in the same second is a real event at a fest entrance; without the
 * index one of them would insert a second "first entry" and the day's entry count
 * would drift upward every time a queue split. The service treats the duplicate
 * key as "already in today" — a re-entry — which is exactly what it is.
 *
 * RE-ENTRIES ARE NOT STORED HERE. The second, fifth and twentieth crossing of the
 * day are already in the append-only `scans` collection with the gate's
 * checkpointId; duplicating them here would make this collection a worse copy of
 * that one. This answers "which day did they arrive"; scans answers "every time
 * they crossed".
 */
const dailyGateCheckInSchema = new mongoose.Schema(
  {
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },

    /*
     * 'YYYY-MM-DD' in the FEST's timezone, produced by helpers/fest-day-helpers.
     * A string, not a Date, so "same day" is string equality and the daily reset
     * needs no cron — see that helper's header for the full reasoning.
     */
    checkInDate: { type: String, required: true, trim: true },

    // The exact instant, kept alongside the day key: the participant's pass shows
    // "checked in at 09:41", which the day key alone cannot answer.
    checkedInAt: { type: Date, required: true, default: Date.now },

    checkedInByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkpointId: { type: mongoose.Schema.Types.ObjectId, ref: "Checkpoint", default: null },
  },
  { timestamps: true }
);

/*
 * The uniqueness that makes a day's entry count trustworthy. festId is in the key
 * even though passId already implies it (a pass belongs to one fest): it makes
 * the index serve the "today's entries for this fest" count below as a prefix
 * scan too, rather than needing a second index for it.
 */
dailyGateCheckInSchema.index(
  { passId: 1, festId: 1, checkInDate: 1 },
  { name: "index_dailyGateCheckIns_passId_festId_checkInDate", unique: true }
);

/* The admin dashboard's read: everyone who entered this fest on this day. */
dailyGateCheckInSchema.index(
  { festId: 1, checkInDate: 1 },
  { name: "index_dailyGateCheckIns_festId_checkInDate" }
);

dailyGateCheckInSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const DailyGateCheckInModel = mongoose.model(
  "DailyGateCheckIn",
  dailyGateCheckInSchema,
  "dailyGateCheckIns"
);

module.exports = { DailyGateCheckInModel };
