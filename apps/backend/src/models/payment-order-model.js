const mongoose = require("mongoose");

const PAYMENT_ORDER_STATUSES = {
  CREATED: "created",
  CAPTURED: "captured",
  FAILED: "failed",
  /*
   * A captured payment whose purchase was cancelled. The platform has no
   * Razorpay refund API today — the refund itself is an out-of-band operation
   * on the Razorpay dashboard; this status is the marker the admin acts on,
   * paired with a refund audit row.
   */
  REFUND_PENDING: "refundPending",
};

/*
 * What the paymentGroupId in this row identifies. registration = a registration
 * payment group (the original meaning); contingent = a contingent purchase, whose
 * group id is the claims' contingentPurchaseGroupId. One orders table, one id
 * slot, one discriminator — deliberately NOT a second orders collection.
 */
/*
 * ADD_ON is a purchase against an ALREADY CONFIRMED registration (see
 * add-on-order-model.js); its rows live in addOnOrders, not in registrations,
 * so every path that reads a payment group must branch on this.
 */
const PAYMENT_ORDER_PURPOSE_TYPES = {
  REGISTRATION: "registration",
  CONTINGENT: "contingent",
  ADD_ON: "addOn",
};

/*
 * The single source of truth linking an internal paymentGroupId to its Razorpay
 * order and payment. One row per payment group; the razorpay ids and the webhook
 * event id are unique-sparse so idempotency is enforced at the data layer.
 */
const paymentOrderSchema = new mongoose.Schema(
  {
    paymentGroupId: { type: String, required: true },
    purposeType: {
      type: String,
      enum: Object.values(PAYMENT_ORDER_PURPOSE_TYPES),
      default: PAYMENT_ORDER_PURPOSE_TYPES.REGISTRATION,
    },
    razorpayOrderId: { type: String, default: null },

    registrationFeePaise: { type: Number, default: 0 },
    platformFeePaise: { type: Number, default: 0 },
    gstAmountPaise: { type: Number, default: 0 },
    totalAmountPaise: { type: Number, default: 0 },

    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    // For webhook idempotency: the x-razorpay-event-id, stored once handled.
    razorpayEventId: { type: String, default: null },

    status: {
      type: String,
      enum: Object.values(PAYMENT_ORDER_STATUSES),
      default: PAYMENT_ORDER_STATUSES.CREATED,
    },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

paymentOrderSchema.index(
  { paymentGroupId: 1 },
  { name: "index_paymentOrders_paymentGroupId", unique: true }
);
paymentOrderSchema.index(
  { razorpayOrderId: 1 },
  { name: "index_paymentOrders_razorpayOrderId", unique: true, sparse: true }
);
/*
 * Webhook idempotency, on the event id alone. A sparse index cannot express this:
 * razorpayEventId defaults to null, so every unpaid order carries the field as a
 * present null — sparse only skips ABSENT fields, so the second such order collides
 * on null and the paid registration 500s at create. A partial index over just the
 * orders that actually carry a webhook event id (a string) enforces the real
 * uniqueness and ignores the many nulls.
 */
paymentOrderSchema.index(
  { razorpayEventId: 1 },
  {
    name: "index_paymentOrders_razorpayEventId",
    unique: true,
    partialFilterExpression: { razorpayEventId: { $type: "string" } },
  }
);

paymentOrderSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const PaymentOrderModel = mongoose.model("PaymentOrder", paymentOrderSchema, "paymentOrders");

module.exports = { PaymentOrderModel, PAYMENT_ORDER_STATUSES, PAYMENT_ORDER_PURPOSE_TYPES };
