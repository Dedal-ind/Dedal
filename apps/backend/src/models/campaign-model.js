const mongoose = require("mongoose");
const {
  PLACEMENT_KEYS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  TARGETING_DIMENSIONS,
} = require("../constants/campaign-constants");

/*
 * THE COMMERCIAL OBJECT, owned by one promoter: a flight window, the
 * placements it may occupy, a priority tier and an in-tier weight, optional
 * pacing and frequency caps, and a targeting predicate.
 *
 * Status mirrors the old promotion lifecycle — draft, published, archived —
 * and the same rules hold: only a draft may be deleted, because a campaign
 * that has been shown to participants is history. Publishing is guarded in
 * campaign-service (an active creative, at least one placement, the
 * per-placement cap), not here.
 */

/*
 * THE TARGETING PREDICATE IS DATA, NOT CODE. The admin console edits it; a
 * future decision engine only evaluates it. It holds include and exclude sets
 * over FIRST-PARTY DECLARED ATTRIBUTES ONLY — the five dimensions in
 * TARGETING_DIMENSIONS — and an absent or empty set means no constraint on
 * that dimension.
 *
 * NOTHING ABOUT A PARTICIPANT'S BEHAVIOUR, HISTORY OR INFERRED INTERESTS MAY
 * APPEAR HERE, EVER. The subschema is `strict: "throw"` so an unknown key
 * (an "interests" list, a "viewedEvents" set, a "segment") is rejected at
 * write time rather than quietly stored. India's DPDP Act, 2023 prohibits
 * profiling and behavioural targeting outright for anyone under eighteen;
 * this model is built so there is nothing of that kind to suppress.
 */
const targetingSetSchema = new mongoose.Schema(
  {
    collegeIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "College" }], default: [] },
    cities: { type: [{ type: String, trim: true }], default: [] },
    departments: { type: [{ type: String, trim: true }], default: [] },
    yearsOfStudy: { type: [{ type: Number, min: 1, max: 6 }], default: [] },
    festIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Fest" }], default: [] },
  },
  { _id: false, strict: "throw" }
);

const targetingSchema = new mongoose.Schema(
  {
    include: { type: targetingSetSchema, default: () => ({}) },
    exclude: { type: targetingSetSchema, default: () => ({}) },
  },
  { _id: false, strict: "throw" }
);

/* Belt to the schema's brace: the closed dimension list, checked by name. */
function assertTargetingDimensionsOnly(targeting) {
  for (const half of ["include", "exclude"]) {
    const set = targeting?.[half];
    if (!set) {
      continue;
    }
    const keys = typeof set.toObject === "function" ? Object.keys(set.toObject()) : Object.keys(set);
    for (const key of keys) {
      if (!TARGETING_DIMENSIONS.includes(key)) {
        throw new Error(
          `Targeting may only name declared attributes (${TARGETING_DIMENSIONS.join(", ")}); "${key}" is not one.`
        );
      }
    }
  }
}

const campaignSchema = new mongoose.Schema(
  {
    promoterId: { type: mongoose.Schema.Types.ObjectId, ref: "Promoter", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: {
      type: String,
      required: true,
      enum: Object.values(CAMPAIGN_STATUSES),
      default: CAMPAIGN_STATUSES.DRAFT,
    },
    flightStartsAt: { type: Date, required: true },
    flightEndsAt: { type: Date, required: true },
    /* The surfaces this campaign may occupy — the primary targeting signal. */
    placementKeys: {
      type: [{ type: String, enum: Object.values(PLACEMENT_KEYS) }],
      default: [],
    },
    priorityTier: {
      type: Number,
      required: true,
      enum: Object.values(CAMPAIGN_PRIORITY_TIERS),
      default: CAMPAIGN_PRIORITY_TIERS.STANDARD,
    },
    /* Decides between campaigns of the SAME tier only. */
    weight: { type: Number, required: true, min: 1, default: 1 },
    /* Optional pacing goal: total impressions across the whole flight.
       deliveredImpressions is the running total the delivery phase will
       increment; the engine reads it to damp or raise the weight. */
    pacing: {
      totalImpressionTarget: { type: Number, min: 1, default: null },
      deliveredImpressions: { type: Number, min: 0, default: 0 },
    },
    /* Optional per-participant frequency cap. */
    frequencyCap: {
      maxPerDay: { type: Number, min: 1, default: null },
      maxPerFlight: { type: Number, min: 1, default: null },
    },
    targeting: { type: targetingSchema, default: () => ({}) },
    /* The ordering the old promotion carried, kept so a migrated carousel
       draws in the same sequence. Ascending within a placement. */
    displayOrder: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    pausedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /* Set by the migration; unique so a re-run reuses rather than duplicates. */
    migratedFromPromotionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promotion",
      default: null,
    },
  },
  { timestamps: true }
);

campaignSchema.pre("validate", function validateCampaign(next) {
  if (
    this.flightStartsAt instanceof Date &&
    this.flightEndsAt instanceof Date &&
    this.flightEndsAt.getTime() <= this.flightStartsAt.getTime()
  ) {
    this.invalidate("flightEndsAt", "The flight must end after it starts.");
  }
  // Deduplicate placement keys silently; naming a surface twice means once.
  if (Array.isArray(this.placementKeys)) {
    this.placementKeys = [...new Set(this.placementKeys)];
  }
  try {
    assertTargetingDimensionsOnly(this.targeting);
  } catch (error) {
    this.invalidate("targeting", error.message);
  }
  return next();
});

/*
 * Only a DRAFT can be deleted. A campaign that has ever been published was
 * shown to participants, so its row is history. Same guard as promotion-model.
 */
function blockNonDraftDeletion(next) {
  if (this.status !== CAMPAIGN_STATUSES.DRAFT) {
    return next(new Error("Only a draft campaign can be deleted."));
  }
  return next();
}
campaignSchema.pre("deleteOne", { document: true, query: false }, blockNonDraftDeletion);

/* "Campaigns eligible for a placement right now": placement + status + window. */
campaignSchema.index(
  { placementKeys: 1, status: 1, flightStartsAt: 1, flightEndsAt: 1 },
  { name: "index_campaigns_placementKeys_status_flightStartsAt_flightEndsAt" }
);
campaignSchema.index({ promoterId: 1, status: 1 }, { name: "index_campaigns_promoterId_status" });
campaignSchema.index(
  { migratedFromPromotionId: 1 },
  {
    name: "index_campaigns_migratedFromPromotionId",
    unique: true,
    partialFilterExpression: { migratedFromPromotionId: { $type: "objectId" } },
  }
);

campaignSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CampaignModel = mongoose.model("Campaign", campaignSchema, "campaigns");

module.exports = { CampaignModel, assertTargetingDimensionsOnly };
