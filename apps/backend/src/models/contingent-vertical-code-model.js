const mongoose = require("mongoose");
const { INVITE_CODE_LENGTH } = require("../constants/registration-constants");

/*
 * One shareable code per (purchase × included sub-event) — the "vertical codes"
 * a buyer hands out so the people actually competing can take the seats the
 * buyer has already paid for.
 *
 * ITS OWN COLLECTION, NOT AN ARRAY ON THE CONTINGENT.
 *
 * A contingent is bought many times over — one purchase per college sending a
 * squad — and the codes belong to a purchase, not to the bundle definition.
 * Embedding them on the contingent would mean every buyer after the first
 * rewriting the same array, and a claimedCount that counts strangers' redemptions
 * alongside your own. Keying by contingentPurchaseGroupId (the same id the
 * claims and the PaymentOrder already share) gives each buyer their own codes,
 * their own counters and their own refund story.
 *
 * A code NEVER creates a seat. It redeems one that is already paid for: the
 * redeeming participant takes over an INVITED claim from that purchase and
 * accepts it. maxClaims is therefore the number of seats the buyer bought for
 * that sub-event, not a capacity anyone can set.
 */
const contingentVerticalCodeSchema = new mongoose.Schema(
  {
    contingentId: { type: mongoose.Schema.Types.ObjectId, ref: "Contingent", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    /* Scopes the code to ONE buyer's purchase — see the note above. */
    contingentPurchaseGroupId: { type: String, required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    /*
     * Snapshot, like the attendee-name fields on a claim: the admin panel and
     * the buyer's success screen list codes beside their vertical, and a rename
     * of the sub-event must not silently retitle a code somebody already shared
     * on a poster.
     */
    eventName: { type: String, required: true, trim: true },
    /*
     * Same alphabet and length as a team invite code (generateInviteCode), so a
     * participant types one kind of thing. The two live in different collections
     * with their own unique indexes; the resolver tries teams first and the
     * probability of a cross-collection collision is handled there, not by
     * making the formats differ.
     */
    inviteCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: INVITE_CODE_LENGTH,
      maxlength: INVITE_CODE_LENGTH,
    },
    /* Written only through the conditional $inc in the redemption service. */
    claimedCount: { type: Number, min: 0, default: 0 },
    maxClaims: { type: Number, required: true, min: 1 },
  },
  { timestamps: true }
);

/*
 * Unique GLOBALLY, not per contingent: a participant types a bare code with no
 * context, so the resolver looks it up by code alone and two contingents sharing
 * one string would make that lookup ambiguous.
 */
contingentVerticalCodeSchema.index(
  { inviteCode: 1 },
  { name: "index_contingentVerticalCodes_inviteCode", unique: true }
);
contingentVerticalCodeSchema.index(
  { contingentPurchaseGroupId: 1 },
  { name: "index_contingentVerticalCodes_purchaseGroupId" }
);
/* One code per (purchase × sub-event) — a retry of code generation must not mint a second. */
contingentVerticalCodeSchema.index(
  { contingentPurchaseGroupId: 1, eventId: 1 },
  { name: "index_contingentVerticalCodes_purchaseGroupId_eventId", unique: true }
);

contingentVerticalCodeSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ContingentVerticalCodeModel = mongoose.model(
  "ContingentVerticalCode",
  contingentVerticalCodeSchema,
  "contingentVerticalCodes"
);

module.exports = { ContingentVerticalCodeModel };
