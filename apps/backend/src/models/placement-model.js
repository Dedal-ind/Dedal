const mongoose = require("mongoose");
const { PLACEMENT_KEYS } = require("../constants/campaign-constants");

/*
 * A named SURFACE a promotion can occupy: the home carousel, a fest detail
 * page, the post-registration screen, the pass screen.
 *
 * This entity is what makes the system contextual rather than behavioural: a
 * campaign names the placements it may appear on, and that — where the
 * participant IS, not who we think they are — is the primary targeting
 * signal.
 *
 * Seeded, not user-created: the keys are a closed enum declared beside the
 * client contract (campaign-constants.PLACEMENT_SEED) and written by the
 * migration. An admin may toggle isActive and adjust the cap; nothing else.
 *
 * maxPublishedCampaigns is the per-placement publish cap. It is enforced in
 * the publish transition (campaign-service), not here, matching where the old
 * per-type cap lived: a business rule about how much a participant should
 * scroll through, not a structural constraint.
 */
const placementSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, enum: Object.values(PLACEMENT_KEYS) },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    isActive: { type: Boolean, required: true, default: true },
    maxPublishedCampaigns: { type: Number, required: true, min: 1 },
  },
  { timestamps: true }
);

placementSchema.index({ key: 1 }, { name: "index_placements_key", unique: true });

placementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const PlacementModel = mongoose.model("Placement", placementSchema, "placements");

module.exports = { PlacementModel };
