const mongoose = require("mongoose");

const PROMOTION_STATUSES = { DRAFT: "draft", PUBLISHED: "published", ARCHIVED: "archived" };

/*
 * commercial  = sponsor banners, merch promos, paid ads.
 * collegeEvent = upcoming fests/events from colleges who contact the super
 *                admin to promote.
 *
 * The type is IDENTITY, not a mutable attribute: the publish cap, the reorder
 * sequence and the participant-facing section a promotion lands in are all
 * scoped by it, so a promotion cannot change type after creation (see
 * promotion-service.updatePromotion).
 */
const PROMOTION_TYPES = { COMMERCIAL: "commercial", COLLEGE_EVENT: "collegeEvent" };

/*
 * What the slide actually PLAYS. Distinct from promotionType, which is about who
 * bought the slot: a commercial promotion and a college-event promotion can each
 * be either a still or a video.
 */
const PROMOTION_MEDIA_TYPES = { IMAGE: "image", VIDEO: "video" };

/*
 * A banner on every participant's home screen.
 *
 * Promotions are PLATFORM-WIDE, not fest-scoped. They appear on every
 * participant's home screen. Only platform admins (super admins) can create or
 * publish them. There is deliberately no festId: a promotion may LINK to a
 * fest, but it does not belong to one, and a college admin must not be able to
 * put their own banner in front of every participant on the platform.
 */
const promotionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true, maxlength: 120 },

    // commercial = sponsor banners, merch promos, paid ads. collegeEvent =
    // upcoming fests/events from colleges who contact the super admin to promote.
    promotionType: {
      type: String,
      required: true,
      enum: Object.values(PROMOTION_TYPES),
    },

    mediaType: {
      type: String,
      enum: Object.values(PROMOTION_MEDIA_TYPES),
      default: PROMOTION_MEDIA_TYPES.IMAGE,
    },

    /*
     * NOT required at the schema level any more — the hook below requires it only
     * for an image promotion. A video promotion still WANTS one: it is the poster
     * frame the carousel shows before playback starts, and without it the slide
     * is a black rectangle until the video buffers.
     */
    imageUrl: { type: String, trim: true, default: null },
    // Direct file (MP4) or a YouTube/Vimeo watch URL; the client picks how to embed.
    videoUrl: { type: String, trim: true, default: null },
    // Optional. A promotion with no link is a display banner, not a dead link.
    linkUrl: { type: String, trim: true, default: null },

    // Optional subtitle or one-liner shown beneath the image on the participant app.
    description: { type: String, trim: true, maxlength: 300, default: null },

    /*
     * Only relevant for the collegeEvent type — which college is promoting.
     * Null for commercial. FREE TEXT, deliberately not a ref to the college
     * model: a college that contacts the super admin to promote its fest may
     * have no account on the platform at all, and refusing the promotion until
     * it registers would be the tail wagging the dog.
     */
    collegeName: { type: String, trim: true, maxlength: 100, default: null },

    // Ascending, WITHIN a type. The admin controls it through the reorder endpoint.
    displayOrder: { type: Number, default: 0 },

    status: {
      type: String,
      enum: Object.values(PROMOTION_STATUSES),
      default: PROMOTION_STATUSES.DRAFT,
    },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },

    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

/*
 * One medium per promotion, and the one it claims must actually be there. A
 * video promotion with no videoUrl renders an empty slide on every participant's
 * home screen, which is the most visible surface the platform has.
 */
promotionSchema.pre("validate", function requireDeclaredMedia(next) {
  if (this.mediaType === PROMOTION_MEDIA_TYPES.VIDEO) {
    if (!this.videoUrl) {
      this.invalidate("videoUrl", "A video promotion needs a videoUrl.");
    }
  } else if (!this.imageUrl) {
    this.invalidate("imageUrl", "An image promotion needs an imageUrl.");
  }
  return next();
});

// The public read is exactly this shape: published rows of ONE type, in display order.
promotionSchema.index(
  { promotionType: 1, status: 1, displayOrder: 1 },
  { name: "index_promotions_promotionType_status_displayOrder" }
);

/*
 * Only a DRAFT can be deleted. A promotion that has ever been published was
 * shown to participants, so its row is history — archiving hides it, deletion
 * would erase the fact that it ran. Same guard shape as staff-assignment-model.
 */
promotionSchema.pre("deleteOne", { document: true, query: false }, function blockPublishedDeletion(next) {
  if (this.status !== PROMOTION_STATUSES.DRAFT) {
    return next(new Error("Only a draft promotion can be deleted."));
  }
  return next();
});

promotionSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const PromotionModel = mongoose.model("Promotion", promotionSchema, "promotions");

module.exports = {
  PromotionModel,
  PROMOTION_STATUSES,
  PROMOTION_TYPES,
  PROMOTION_MEDIA_TYPES,
};
