const { DailyCapLedgerModel, FlightCapLedgerModel } = require("../models/frequency-cap-ledger-model");

/*
 * Reads and increments of the frequency cap ledger.
 *
 * NOTHING CALLS THE INCREMENT IN THIS PHASE. A cap counts impressions actually
 * SEEN, not decisions made, so the delivery-tracking phase is what will call
 * recordImpression when a client reports an impression against a decision
 * token. The read is what the decision engine uses now.
 */

/* Rows for a day are kept a little past the day so a late report still lands. */
const DAILY_ROW_GRACE_MILLISECONDS = 6 * 60 * 60 * 1000;
const FLIGHT_ROW_GRACE_MILLISECONDS = 24 * 60 * 60 * 1000;

function utcDayOf(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

/* Midnight UTC after the given instant, plus grace: when the daily row dies. */
function dailyExpiryFor(at) {
  const nextMidnight = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1)
  );
  return new Date(nextMidnight.getTime() + DAILY_ROW_GRACE_MILLISECONDS);
}

/*
 * ONE atomic upsert-and-increment per ledger. $inc creates the count on
 * insert and adds to it afterwards; $setOnInsert writes the expiry ONLY when
 * the document is created. Two concurrent calls on the same key therefore
 * produce an exact count of two and one expiry, never a moved or missing one.
 * `new: true` returns the row after the increment so the caller sees the
 * count it just produced.
 */
async function recordImpression({ subjectKey, campaignId, flightEndsAt, at = new Date() }) {
  const day = utcDayOf(at);
  const [daily, flight] = await Promise.all([
    DailyCapLedgerModel.findOneAndUpdate(
      { subjectKey, campaignId, day },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: dailyExpiryFor(at) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    FlightCapLedgerModel.findOneAndUpdate(
      { subjectKey, campaignId },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          expiresAt: new Date(new Date(flightEndsAt).getTime() + FLIGHT_ROW_GRACE_MILLISECONDS),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
  ]);
  return { day, dailyCount: daily.count, flightCount: flight.count };
}

/*
 * The counts the engine reads before selection: for one subject, today's and
 * the flight-total count against each named campaign. Two indexed reads over
 * at most a few dozen ids — the same cost whether the platform has a hundred
 * participants or a million.
 */
async function readCounts({ subjectKey, campaignIds, at = new Date() }) {
  const day = utcDayOf(at);
  const [dailyRows, flightRows] = await Promise.all([
    DailyCapLedgerModel.find({ subjectKey, campaignId: { $in: campaignIds }, day })
      .select("campaignId count")
      .lean(),
    FlightCapLedgerModel.find({ subjectKey, campaignId: { $in: campaignIds } })
      .select("campaignId count")
      .lean(),
  ]);
  const counts = new Map();
  for (const id of campaignIds) {
    counts.set(String(id), { daily: 0, flight: 0 });
  }
  for (const row of dailyRows) {
    counts.get(String(row.campaignId)).daily = row.count;
  }
  for (const row of flightRows) {
    counts.get(String(row.campaignId)).flight = row.count;
  }
  return counts;
}

module.exports = { recordImpression, readCounts, utcDayOf, dailyExpiryFor };
