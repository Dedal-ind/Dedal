const mongoose = require("mongoose");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_NAME_MAX_LENGTH,
  CONTINGENT_EVENTS_MINIMUM,
  CONTINGENT_EVENTS_MAXIMUM,
} = require("../constants/contingent-constants");

/*
 * A priced bundle of SOLO sub-events under one parent event. Only PUBLISHED
 * contingents are buyable. Once a single purchase exists, includedEventIds and
 * pricePaise are frozen (enforced in the service — the schema cannot see the
 * claims collection); name and description stay editable. A contingent is never
 * deleted after purchase — it is CANCELLED, which hides it from participants
 * while keeping existing claims intact.
 */
const contingentSchema = new mongoose.Schema(
  {
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    /*
     * The "management event" the bundle hangs under — a container, not a leaf.
     *
     * NULLABLE, because a bundle has two possible scopes and only one of them is
     * an event. A three-layer fest (fest → main event → verticals) hangs the
     * bundle off the main event, which is what this field names. A two-layer fest
     * (fest → events) has no such container, so the bundle hangs off the FEST
     * itself and this is null — festId alone identifies the scope. Making it
     * optional rather than inventing a synthetic parent event keeps the tree
     * honest: there is no container in a two-layer fest, so none is fabricated.
     */
    parentEventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    contingentName: {
      type: String,
      required: true,
      trim: true,
      maxlength: CONTINGENT_NAME_MAX_LENGTH,
    },
    description: { type: String, trim: true, default: null },
    includedEventIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
      required: true,
      validate: {
        validator(eventIds) {
          const uniqueCount = new Set(eventIds.map(String)).size;
          return (
            eventIds.length >= CONTINGENT_EVENTS_MINIMUM &&
            eventIds.length <= CONTINGENT_EVENTS_MAXIMUM &&
            uniqueCount === eventIds.length
          );
        },
        message: `A contingent needs between ${CONTINGENT_EVENTS_MINIMUM} and ${CONTINGENT_EVENTS_MAXIMUM} distinct sub-events.`,
      },
    },
    /* The whole-bundle price. Integer paise, like every amount in the system. */
    pricePaise: { type: Number, required: true, min: 0 },
    /*
     * Snapshot of the sum of the included events' feeAmountPaise at creation,
     * updated on edit. Renders "you save ₹X" in the participant app; snapshotted
     * so a mid-fest event fee edit doesn't rewrite historic marketing copy.
     */
    individualTotalPaise: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      required: true,
      enum: Object.values(CONTINGENT_STATUSES),
      default: CONTINGENT_STATUSES.DRAFT,
    },
    /*
     * Cap on how many bundles may be sold; null = limited only by the sub-events'
     * own capacities. This is the answer to "how do we stop the parent event being
     * oversold when five buyers each purchase five seats" — the bundle count is
     * claimed with the same conditional-$inc pattern as event seats (see
     * claimBundleSlot in contingent-purchase-service).
     */
    maximumBundleClaims: { type: Number, min: 1, default: null },
    /* Denormalised bundle counter; written only through the conditional claim. */
    soldBundleCount: { type: Number, min: 0, default: 0 },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

/*
 * The scope must be identifiable. festId is required above, so this can only
 * fail on a document built without one — but the rule is stated rather than
 * implied, because parentEventId becoming optional is exactly the change that
 * makes "which scope is this?" a question a reader has to ask.
 */
contingentSchema.pre("validate", function validateContingentScope(next) {
  if (!this.festId && !this.parentEventId) {
    this.invalidate("festId", "A contingent needs a festId, or a parentEventId, to scope it.");
  }
  return next();
});

contingentSchema.index({ festId: 1, status: 1 }, { name: "index_contingents_festId_status" });
contingentSchema.index(
  { parentEventId: 1, status: 1 },
  { name: "index_contingents_parentEventId_status" }
);

contingentSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ContingentModel = mongoose.model("Contingent", contingentSchema, "contingents");

module.exports = { ContingentModel };
