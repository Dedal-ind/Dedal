const mongoose = require("mongoose");
const {
  DELIVERY_EVENT_KINDS,
  RAW_EVENT_RETENTION_SECONDS,
} = require("../constants/delivery-constants");
const { PLACEMENT_KEYS } = require("../constants/campaign-constants");

/*
 * THE DELIVERY EVENT STORE: one small row per event, append-only.
 *
 * A TIME-SERIES COLLECTION. MongoDB 5.0+ supports them and both the test
 * binary (7.0) and the Atlas deployment do. The grouping fields — campaign,
 * creative, placement, kind — are the METADATA and `at` is the TIME FIELD, so
 * a range query over a campaign and a window hits the clustered index and the
 * buckets are packed by those groups. Granularity is "hours": ingest is a
 * few events per participant per screen, not thousands per second, and
 * coarse buckets suit a low rate. The collection-level expireAfterSeconds
 * is the TTL: raw rows are the audit trail, the rollups are the reporting
 * source, so thirty days of raw is plenty.
 *
 * NO UNIQUE INDEX HERE — time-series collections do not support one. The
 * once-per-token-per-kind guarantee lives on the receipt collection
 * (delivery-receipt-model), whose unique index is what an ingest must pass
 * before a row is appended here.
 *
 * The collection must be created explicitly (DeliveryEventModel.createCollection)
 * before the first insert, or the driver creates a plain collection with none
 * of the above. delivery-service.ensureEventStore does that once.
 */
const deliveryEventSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    meta: {
      campaignId: { type: mongoose.Schema.Types.ObjectId, required: true },
      creativeId: { type: mongoose.Schema.Types.ObjectId, required: true },
      placementKey: { type: String, required: true, enum: Object.values(PLACEMENT_KEYS) },
      kind: { type: String, required: true, enum: Object.values(DELIVERY_EVENT_KINDS) },
    },
    /* The token the event was reported against — the link back to the decision. */
    token: { type: String, required: true },
    /* Server receipt time; `at` is the moment the event occurred. */
    receivedAt: { type: Date, required: true },
  },
  {
    versionKey: false,
    timeseries: { timeField: "at", metaField: "meta", granularity: "hours" },
    expireAfterSeconds: RAW_EVENT_RETENTION_SECONDS,
    autoCreate: false,
  }
);

const DeliveryEventModel = mongoose.model("DeliveryEvent", deliveryEventSchema, "deliveryEvents");

module.exports = { DeliveryEventModel };
