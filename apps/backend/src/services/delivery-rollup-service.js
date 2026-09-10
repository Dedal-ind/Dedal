const { DeliveryEventModel } = require("../models/delivery-event-model");
const {
  DeliveryDailyRollupModel,
  DeliveryRollupStateModel,
} = require("../models/delivery-rollup-model");
const { CampaignModel } = require("../models/campaign-model");
const { DELIVERY_EVENT_KINDS } = require("../constants/delivery-constants");
const { utcDayOf } = require("./frequency-cap-service");
const { ensureEventStore } = require("./delivery-service");

/*
 * THE ROLLUP JOB: raw delivery events → daily counts per campaign, creative,
 * placement and kind; then the campaigns' delivered-impressions counters
 * from the viewable counts.
 *
 * IDEMPOTENT BY CONSTRUCTION. Each day is recomputed in full and written
 * with $set — never $inc — so running twice over the same day yields the
 * same numbers, and a day with no events yields no rows. The state document
 * records the last COMPLETED day, so a normal run resumes from there and
 * re-rolls only the days since (the current, still-open day is always
 * recomputed, because it is still receiving events).
 *
 * NO CRON, NO QUEUE: a plain setInterval sweep started from server.js, the
 * same pattern as the shift reminder sweep. A run is also invocable directly
 * (tests, an operator).
 */

const ROLLUP_STATE_ID = "deliveryRollup";
const ROLLUP_SWEEP_INTERVAL_MILLISECONDS = 15 * 60 * 1000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function dayStart(day) {
  return new Date(`${day}T00:00:00.000Z`);
}

function addDays(day, count) {
  return utcDayOf(new Date(dayStart(day).getTime() + count * DAY_MILLISECONDS));
}

/* Recompute one UTC day's totals and write them. Returns rows written. */
async function rollupDay(day, rolledUpAt) {
  const from = dayStart(day);
  const to = new Date(from.getTime() + DAY_MILLISECONDS);
  const groups = await DeliveryEventModel.aggregate([
    { $match: { at: { $gte: from, $lt: to } } },
    {
      $group: {
        _id: {
          campaignId: "$meta.campaignId",
          creativeId: "$meta.creativeId",
          placementKey: "$meta.placementKey",
          kind: "$meta.kind",
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const totalsByGroup = new Map();
  for (const row of groups) {
    const { campaignId, creativeId, placementKey, kind } = row._id;
    const key = `${campaignId}|${creativeId}|${placementKey}`;
    if (!totalsByGroup.has(key)) {
      totalsByGroup.set(key, {
        campaignId,
        creativeId,
        placementKey,
        decision: 0,
        measurable: 0,
        viewable: 0,
        click: 0,
      });
    }
    totalsByGroup.get(key)[kind] = row.count;
  }

  if (totalsByGroup.size === 0) {
    return 0;
  }
  await DeliveryDailyRollupModel.bulkWrite(
    [...totalsByGroup.values()].map((totals) => ({
      updateOne: {
        filter: {
          campaignId: totals.campaignId,
          creativeId: totals.creativeId,
          placementKey: totals.placementKey,
          day,
        },
        update: {
          $set: {
            decision: totals.decision,
            measurable: totals.measurable,
            viewable: totals.viewable,
            click: totals.click,
            rolledUpAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return totalsByGroup.size;
}

/*
 * The pacing counter: total viewables per campaign across all rolled-up
 * days, written with $set. Only campaigns that appear in the rollups are
 * touched; the rest keep their zero.
 */
async function refreshDeliveredImpressions() {
  const totals = await DeliveryDailyRollupModel.aggregate([
    { $group: { _id: "$campaignId", viewable: { $sum: "$viewable" } } },
  ]);
  if (totals.length === 0) {
    return 0;
  }
  await CampaignModel.bulkWrite(
    totals.map((row) => ({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { "pacing.deliveredImpressions": row.viewable } },
      },
    })),
    { ordered: false }
  );
  return totals.length;
}

/*
 * One run. Rolls every day from the day after the last completed one up to
 * and including today, marks every day before today as completed, and
 * refreshes the delivered counters. `now` is injectable for tests.
 */
async function runDeliveryRollup({ now = new Date() } = {}) {
  await ensureEventStore();
  const today = utcDayOf(now);
  const state = await DeliveryRollupStateModel.findById(ROLLUP_STATE_ID).lean();

  /*
   * First ever run: start from the earliest raw event, or today if there are
   * none. Resumed run: the day after the last completed day.
   */
  let firstDay;
  if (state?.completedThroughDay) {
    firstDay = addDays(state.completedThroughDay, 1);
  } else {
    const earliest = await DeliveryEventModel.findOne({}).sort({ at: 1 }).select("at").lean();
    firstDay = earliest ? utcDayOf(earliest.at) : today;
  }
  if (firstDay > today) {
    firstDay = today;
  }

  const report = { daysRolled: 0, rowsWritten: 0, campaignsRefreshed: 0, completedThroughDay: null };
  for (let day = firstDay; day <= today; day = addDays(day, 1)) {
    report.rowsWritten += await rollupDay(day, now);
    report.daysRolled += 1;
  }
  report.campaignsRefreshed = await refreshDeliveredImpressions();

  /* Yesterday is the last COMPLETED day; today stays open and is re-rolled next run. */
  const completedThroughDay = addDays(today, -1);
  await DeliveryRollupStateModel.updateOne(
    { _id: ROLLUP_STATE_ID },
    { $set: { completedThroughDay, lastRunAt: now } },
    { upsert: true }
  );
  report.completedThroughDay = completedThroughDay;
  return report;
}

function startDeliveryRollupSweep(intervalMilliseconds = ROLLUP_SWEEP_INTERVAL_MILLISECONDS) {
  const timer = setInterval(() => {
    runDeliveryRollup().catch((error) => {
      console.error(`Delivery rollup failed: ${error.message}`);
    });
  }, intervalMilliseconds);
  timer.unref();
  return timer;
}

module.exports = {
  runDeliveryRollup,
  rollupDay,
  refreshDeliveredImpressions,
  startDeliveryRollupSweep,
  ROLLUP_SWEEP_INTERVAL_MILLISECONDS,
  ROLLUP_STATE_ID,
};
