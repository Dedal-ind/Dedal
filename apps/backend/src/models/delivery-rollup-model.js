const mongoose = require("mongoose");
const { PLACEMENT_KEYS } = require("../constants/campaign-constants");
const { DELIVERY_REJECTION_REASONS } = require("../constants/delivery-constants");

/*
 * THE REPORTING SOURCE: counts per campaign, creative, placement and UTC day,
 * one field per event kind. Admin reporting reads ONLY this, never the raw
 * event store. Written by the rollup job (delivery-rollup-service) with
 * recomputed totals — $set, not $inc — so re-running over a day already
 * rolled up produces the same numbers again rather than doubling them.
 */
const deliveryDailyRollupSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    creativeId: { type: mongoose.Schema.Types.ObjectId, ref: "Creative", required: true },
    placementKey: { type: String, required: true, enum: Object.values(PLACEMENT_KEYS) },
    /* "YYYY-MM-DD", UTC. */
    day: { type: String, required: true },
    decision: { type: Number, required: true, default: 0, min: 0 },
    measurable: { type: Number, required: true, default: 0, min: 0 },
    viewable: { type: Number, required: true, default: 0, min: 0 },
    click: { type: Number, required: true, default: 0, min: 0 },
    rolledUpAt: { type: Date, required: true },
  },
  { versionKey: false }
);

deliveryDailyRollupSchema.index(
  { campaignId: 1, creativeId: 1, placementKey: 1, day: 1 },
  { name: "index_deliveryDailyRollups_campaignId_creativeId_placementKey_day", unique: true }
);
deliveryDailyRollupSchema.index({ day: 1 }, { name: "index_deliveryDailyRollups_day" });

/*
 * Where the job got to. A single document: the job resumes from
 * completedThroughDay rather than re-reading history, and re-running over
 * the same range is harmless because rollup writes are recomputed totals.
 */
const deliveryRollupStateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    /* The last UTC day fully rolled up ("YYYY-MM-DD"), or null before the first run. */
    completedThroughDay: { type: String, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { versionKey: false }
);

/*
 * Invalid-traffic rejections, counted per day and reason with an atomic
 * upsert-increment, so the rate is visible without keeping the events.
 */
const deliveryRejectionSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    reason: { type: String, required: true, enum: Object.values(DELIVERY_REJECTION_REASONS) },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { versionKey: false }
);

deliveryRejectionSchema.index(
  { day: 1, reason: 1 },
  { name: "index_deliveryRejections_day_reason", unique: true }
);

const DeliveryDailyRollupModel = mongoose.model(
  "DeliveryDailyRollup",
  deliveryDailyRollupSchema,
  "deliveryDailyRollups"
);
const DeliveryRollupStateModel = mongoose.model(
  "DeliveryRollupState",
  deliveryRollupStateSchema,
  "deliveryRollupState"
);
const DeliveryRejectionModel = mongoose.model(
  "DeliveryRejection",
  deliveryRejectionSchema,
  "deliveryRejections"
);

module.exports = { DeliveryDailyRollupModel, DeliveryRollupStateModel, DeliveryRejectionModel };
