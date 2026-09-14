const mongoose = require("mongoose");
const { CONTINGENT_PURCHASE_STATUSES } = require("../constants/contingent-constants");
const { INVITE_CODE_LENGTH } = require("../constants/registration-constants");
const { EVENT_TYPES } = require("../constants/event-constants");

/*
 * One buyer's purchase of a CODE-DISTRIBUTION contingent.
 *
 * The buyer is paying for access, not naming people: this row is the receipt
 * and the codes are the product. The buyer is not a participant because of it —
 * they become one only by redeeming a code themselves, exactly like anyone they
 * hand a code to.
 *
 * ONE CODE PER INCLUDED EVENT, and how many people it admits depends on the event:
 *   · solo — maxUses 1. One person redeems it and it is spent.
 *   · team — maxUses is the event's maximum team size. Everyone who redeems the
 *            code joins the SAME team; the code is that team's invite mechanism,
 *            and the team's own invite code is never used for it.
 *
 * WHY THE CODES ARE EMBEDDED. A code belongs to exactly one purchase, so the
 * purchase is its natural owner, and taking a use is a single positional update
 * whose filter carries the "still has room" and "not already yours" checks.
 *
 * The legacy claim-based purchase (contingentClaims) is untouched and still read
 * by its own endpoints; this collection is only ever written by the new flow.
 */
const codeClaimSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    claimedAt: { type: Date, required: true },
    /* The registration this use created — the roster and any unwind read it. */
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", default: null },
  },
  { _id: false }
);

const contingentCodeSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    /*
     * Same generator, alphabet and length as a team invite code, so a
     * participant types one kind of thing into one kind of box.
     */
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: INVITE_CODE_LENGTH,
      maxlength: INVITE_CODE_LENGTH,
    },
    /* Snapshot at minting: the uses were sized from it, so it must not drift. */
    eventType: { type: String, required: true, enum: Object.values(EVENT_TYPES) },
    maxUses: { type: Number, required: true, min: 1 },
    claims: { type: [codeClaimSchema], default: [] },
  },
  { _id: false, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/*
 * Computed, never stored: a stored flag would be a second fact about the claims
 * array, free to disagree with it after a compensating pull.
 */
function isContingentCodeFull(codeEntry) {
  return (codeEntry?.claims?.length ?? 0) >= codeEntry.maxUses;
}

contingentCodeSchema.virtual("isFull").get(function computeIsFull() {
  return isContingentCodeFull(this);
});

const contingentPurchaseSchema = new mongoose.Schema(
  {
    contingentId: { type: mongoose.Schema.Types.ObjectId, ref: "Contingent", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    buyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /* Snapshot of what was charged for the bundle itself, before platform fee. */
    pricePaise: { type: Number, required: true, min: 0 },
    /* Null for a free purchase — nothing went through Razorpay. */
    paymentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentOrder", default: null },
    /* The key the capture dispatch arrives with; mirrors PaymentOrder.paymentGroupId. */
    paymentGroupId: { type: String, default: null },
    status: {
      type: String,
      required: true,
      enum: Object.values(CONTINGENT_PURCHASE_STATUSES),
      default: CONTINGENT_PURCHASE_STATUSES.PENDING,
    },
    /* Empty until the purchase completes: an unpaid purchase has no codes to leak. */
    codes: { type: [contingentCodeSchema], default: [] },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/*
 * A code is unique across EVERY purchase, because it is typed with no context
 * and looked up by the string alone.
 *
 * The partial filter is load-bearing. A multikey unique index indexes a document
 * whose array is empty under a null key, so the second pending purchase (codes:
 * []) would collide with the first on "null" and the paid checkout would 500.
 * Uniqueness WITHIN one purchase's array is not something a multikey index
 * enforces; the minting service guarantees it before the write.
 */
contingentPurchaseSchema.index(
  { "codes.code": 1 },
  {
    name: "index_contingentPurchases_codes_code",
    unique: true,
    partialFilterExpression: { "codes.code": { $type: "string" } },
  }
);
contingentPurchaseSchema.index(
  { buyerUserId: 1, createdAt: -1 },
  { name: "index_contingentPurchases_buyerUserId_createdAt" }
);
contingentPurchaseSchema.index(
  { contingentId: 1, status: 1 },
  { name: "index_contingentPurchases_contingentId_status" }
);
contingentPurchaseSchema.index(
  { paymentGroupId: 1 },
  {
    name: "index_contingentPurchases_paymentGroupId",
    unique: true,
    partialFilterExpression: { paymentGroupId: { $type: "string" } },
  }
);

contingentPurchaseSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ContingentPurchaseModel = mongoose.model(
  "ContingentPurchase",
  contingentPurchaseSchema,
  "contingentPurchases"
);

/*
 * A code's expiry IS its fest's end. Derived on every read and never stored, so
 * an organiser extending the fest extends every code under it with no backfill.
 * The boundary is fest.endsOn exactly — the same instant gate access and offer
 * claims stop being valid, so a code never outlives the pass it would produce.
 */
function resolveContingentCodeExpiresAt(fest) {
  return fest?.endsOn ?? null;
}

function isContingentCodeExpired(fest, now = new Date()) {
  const expiresAt = resolveContingentCodeExpiresAt(fest);
  return Boolean(expiresAt) && now.getTime() > new Date(expiresAt).getTime();
}

module.exports = {
  ContingentPurchaseModel,
  isContingentCodeFull,
  resolveContingentCodeExpiresAt,
  isContingentCodeExpired,
};
