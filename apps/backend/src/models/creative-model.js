const mongoose = require("mongoose");
const { CREATIVE_MEDIA_TYPES, CREATIVE_STATUSES } = require("../constants/campaign-constants");

/*
 * THE MEDIA: an image or a video, its poster frame, a link, a title and a
 * description. Exactly the fields the old promotion row carried for the slide
 * itself.
 *
 * A creative belongs to a PROMOTER, not to a campaign, so the same artwork can
 * run in more than one campaign. Rotation weight and pause are NOT here: they
 * are properties of running this creative in this campaign, and live on the
 * campaign-creative association.
 */
const creativeSchema = new mongoose.Schema(
  {
    promoterId: { type: mongoose.Schema.Types.ObjectId, ref: "Promoter", required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mediaType: {
      type: String,
      required: true,
      enum: Object.values(CREATIVE_MEDIA_TYPES),
      default: CREATIVE_MEDIA_TYPES.IMAGE,
    },
    /* The still, or for a video the poster frame shown before playback. */
    imageUrl: { type: String, trim: true, default: null },
    videoUrl: { type: String, trim: true, default: null },
    linkUrl: { type: String, trim: true, default: null },
    description: { type: String, trim: true, maxlength: 300, default: null },
    /* Archived, never deleted. A creative a published campaign runs cannot be
       archived (promoter-service); one used only by drafts can. */
    status: {
      type: String,
      required: true,
      enum: Object.values(CREATIVE_STATUSES),
      default: CREATIVE_STATUSES.ACTIVE,
    },
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

/*
 * Same rule as the promotion model: the medium it claims must be there.
 *
 * A VIDEO ALSO NEEDS ITS POSTER, BUT ONLY WHEN NEW.
 *
 * imageUrl has always been documented above as the poster frame for a video,
 * and the participant surface genuinely depends on it: it is what shows before
 * playback, what a slow connection gets instead of autoplay, and what the pass
 * screen shows in place of a video it deliberately will not play. A video
 * creative without one has nothing to render in any of those three cases.
 *
 * `isNew` is what keeps this from being a breaking change. Requiring the poster
 * unconditionally would make every video creative already saved without one
 * fail its next save — including an admin merely renaming it — so the rule
 * binds creation, where it costs nothing, and leaves existing rows editable.
 */
creativeSchema.pre("validate", function requireDeclaredMedia(next) {
  if (this.mediaType === CREATIVE_MEDIA_TYPES.VIDEO) {
    if (!this.videoUrl) {
      this.invalidate("videoUrl", "A video creative needs a videoUrl.");
    }
    if (this.isNew && !this.imageUrl) {
      this.invalidate("imageUrl", "A video creative needs a poster image.");
    }
  } else if (!this.imageUrl) {
    this.invalidate("imageUrl", "An image creative needs an imageUrl.");
  }
  return next();
});

creativeSchema.index({ promoterId: 1, createdAt: -1 }, { name: "index_creatives_promoterId_createdAt" });
creativeSchema.index({ promoterId: 1, status: 1 }, { name: "index_creatives_promoterId_status" });
creativeSchema.index(
  { migratedFromPromotionId: 1 },
  {
    name: "index_creatives_migratedFromPromotionId",
    unique: true,
    partialFilterExpression: { migratedFromPromotionId: { $type: "objectId" } },
  }
);

creativeSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CreativeModel = mongoose.model("Creative", creativeSchema, "creatives");

module.exports = { CreativeModel };
