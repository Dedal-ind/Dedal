const mongoose = require("mongoose");
const {
  DELIVERY_EVENT_KINDS,
  RECEIPT_RETENTION_SECONDS,
} = require("../constants/delivery-constants");

/*
 * THE IDEMPOTENCY GUARD: one row per (token, kind), under a UNIQUE index.
 *
 * Each kind may be recorded at most once per decision token. Clients retry —
 * a page unload flushes a batch that may already have landed — and a retry
 * must not inflate anything. The guard is the unique index, not a read-then-
 * write: two concurrent duplicates race to insert, one wins, the other gets
 * E11000 and is reported as a duplicate. Only the winner appends an event
 * row and (for a viewable) touches the cap ledgers.
 *
 * Lives beside the time-series store because time-series collections cannot
 * carry a unique index. Short TTL: a token expires in fifteen minutes, so a
 * receipt older than a week guards nothing.
 */
const deliveryReceiptSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    kind: { type: String, required: true, enum: Object.values(DELIVERY_EVENT_KINDS) },
    at: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

deliveryReceiptSchema.index(
  { token: 1, kind: 1 },
  { name: "index_deliveryReceipts_token_kind", unique: true }
);
deliveryReceiptSchema.index(
  { createdAt: 1 },
  { name: "index_deliveryReceipts_createdAt_ttl", expireAfterSeconds: RECEIPT_RETENTION_SECONDS }
);

const DeliveryReceiptModel = mongoose.model(
  "DeliveryReceipt",
  deliveryReceiptSchema,
  "deliveryReceipts"
);

module.exports = { DeliveryReceiptModel };
