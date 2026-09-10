const mongoose = require("mongoose");
const { CONTINGENT_CLAIM_STATUSES } = require("../constants/contingent-constants");
const { PAYMENT_STATUSES } = require("../constants/registration-constants");

/*
 * One row per (contingent purchase × included sub-event) — the thing a
 * coordinator's roster reads before the attendee has accepted. The seat in the
 * sub-event is claimed at purchase time and travels with this row: released on
 * decline/cancel/expiry, converted into a Registration on accept.
 *
 * The attendee snapshot fields exist because the buyer typed them: the attendee's
 * user record may carry nothing (a placeholder created by
 * findOrCreateUserByEmailAddress) until they sign in and complete their profile,
 * and the coordinator still needs a name to read against the seat.
 */
const contingentClaimSchema = new mongoose.Schema(
  {
    contingentId: { type: mongoose.Schema.Types.ObjectId, ref: "Contingent", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    /*
     * Shared across every row of one buyer's purchase — the same slot semantics as
     * paymentGroupId across a team's paid rows. The PaymentOrder for the purchase
     * carries this value in its paymentGroupId field (purposeType: "contingent").
     */
    contingentPurchaseGroupId: { type: String, required: true },

    buyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /* Created via findOrCreateUserByEmailAddress at purchase; null only if the
     * attendee is later removed by an erasure operation. */
    attendeeUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    attendeeEmailAddress: { type: String, required: true, trim: true, lowercase: true },
    attendeeFullName: { type: String, required: true, trim: true },
    attendeePhoneNumber: { type: String, required: true, trim: true },

    /* Populated when the claim materialises into a Registration row on accept. */
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", default: null },

    claimStatus: {
      type: String,
      required: true,
      enum: Object.values(CONTINGENT_CLAIM_STATUSES),
      default: CONTINGENT_CLAIM_STATUSES.INVITED,
    },
    /*
     * The BUYER's payment for the bundle, mirrored on each claim so the expiry
     * sweep and the roster can filter unpaid holds without joining the order.
     * pending until Razorpay captures; completed after; expired if the hold
     * lapsed first (the same 30-minute window as registrations).
     */
    paymentStatus: {
      type: String,
      required: true,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.PENDING,
    },

    invitedAt: { type: Date, required: true, default: Date.now },
    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

contingentClaimSchema.index(
  { attendeeUserId: 1, claimStatus: 1 },
  { name: "index_contingentClaims_attendeeUserId_claimStatus" }
);
/*
 * The coordinator roster query: claims for one event by status. Covered for that
 * read — the fields the roster filter and sort touch are all in the key.
 */
contingentClaimSchema.index(
  { eventId: 1, claimStatus: 1, invitedAt: 1 },
  { name: "index_contingentClaims_eventId_claimStatus_invitedAt" }
);
contingentClaimSchema.index(
  { contingentPurchaseGroupId: 1 },
  { name: "index_contingentClaims_contingentPurchaseGroupId" }
);
contingentClaimSchema.index(
  { contingentId: 1, claimStatus: 1 },
  { name: "index_contingentClaims_contingentId_claimStatus" }
);

contingentClaimSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ContingentClaimModel = mongoose.model(
  "ContingentClaim",
  contingentClaimSchema,
  "contingentClaims"
);

module.exports = { ContingentClaimModel };
