const mongoose = require("mongoose");

/*
 * THE FREQUENCY CAP LEDGER: how many times ONE subject has seen ONE campaign,
 * today and across the campaign's flight.
 *
 * Two small collections, one document per subject per campaign per calendar
 * day (the daily ledger) and one per subject per campaign (the flight ledger).
 * Each holds a count and an expiry; a TTL index removes the row when the
 * expiry passes, the same pattern otp-code-model and client-error-log-model
 * already use. A cap is READ from these counts, never derived by counting
 * delivery events — that read grows without bound and is the thing that works
 * at a hundred users and dies at ten thousand.
 *
 * THE SUBJECT KEY IS NOT ALWAYS A PERSON. For an adult it is the user id. For
 * a participant who is under eighteen — or whose age is UNKNOWN — it is an
 * opaque per-session key, so nothing about a child's exposure is ever keyed
 * to their identity. See decision-engine-service.resolveSubject.
 *
 * THE INCREMENT IS ONE ATOMIC UPSERT (frequency-cap-service): $inc on the
 * count, $setOnInsert on the expiry. The expiry is applied ONLY when the
 * document is created, never on a later increment. This is load-bearing: the
 * equivalent bug in every Redis implementation is "INCR, then EXPIRE when the
 * count reads 1", which under concurrency lets two simultaneous requests both
 * increment before either sets the expiry — so the window is extended on
 * every call, or never set at all. Setting it only at insert time closes that
 * natively.
 */

const dailyCapLedgerSchema = new mongoose.Schema(
  {
    subjectKey: { type: String, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    /* The UTC calendar day, "YYYY-MM-DD". */
    day: { type: String, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false }
);

dailyCapLedgerSchema.index(
  { subjectKey: 1, campaignId: 1, day: 1 },
  { name: "index_dailyCapLedger_subjectKey_campaignId_day", unique: true }
);
dailyCapLedgerSchema.index(
  { expiresAt: 1 },
  { name: "index_dailyCapLedger_expiresAt_ttl", expireAfterSeconds: 0 }
);

const flightCapLedgerSchema = new mongoose.Schema(
  {
    subjectKey: { type: String, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    /* The flight's end plus a grace period, applied on insert only. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false }
);

flightCapLedgerSchema.index(
  { subjectKey: 1, campaignId: 1 },
  { name: "index_flightCapLedger_subjectKey_campaignId", unique: true }
);
flightCapLedgerSchema.index(
  { expiresAt: 1 },
  { name: "index_flightCapLedger_expiresAt_ttl", expireAfterSeconds: 0 }
);

const DailyCapLedgerModel = mongoose.model("DailyCapLedger", dailyCapLedgerSchema, "dailyCapLedger");
const FlightCapLedgerModel = mongoose.model(
  "FlightCapLedger",
  flightCapLedgerSchema,
  "flightCapLedger"
);

module.exports = { DailyCapLedgerModel, FlightCapLedgerModel };
