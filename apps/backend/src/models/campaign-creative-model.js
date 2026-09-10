const mongoose = require("mongoose");

/*
 * THE JOIN between a campaign and a creative: this creative runs in this
 * campaign, with this rotation weight, and is currently active or paused.
 *
 * Deliberately a separate row rather than fields on the creative: rotation
 * weight and pause are properties of running THIS creative in THIS campaign.
 * Folding them into the creative would make one artwork unshareable across
 * campaigns, which is the whole reason creatives belong to promoters.
 */
const campaignCreativeSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    creativeId: { type: mongoose.Schema.Types.ObjectId, ref: "Creative", required: true },
    rotationWeight: { type: Number, required: true, min: 1, default: 1 },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true }
);

/* One row per pair, and "associations by campaign" served by the same key. */
campaignCreativeSchema.index(
  { campaignId: 1, creativeId: 1 },
  { name: "index_campaignCreatives_campaignId_creativeId", unique: true }
);
campaignCreativeSchema.index({ creativeId: 1 }, { name: "index_campaignCreatives_creativeId" });

campaignCreativeSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CampaignCreativeModel = mongoose.model(
  "CampaignCreative",
  campaignCreativeSchema,
  "campaignCreatives"
);

module.exports = { CampaignCreativeModel };
