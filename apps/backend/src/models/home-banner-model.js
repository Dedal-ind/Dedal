const mongoose = require("mongoose");

/*
 * THE HOME BANNER: what the big hero at the top of the participant Discover
 * screen shows. One document for the whole platform (settingKey "home"),
 * edited by the platform admin.
 *
 *   automatic — the client's built-in rule: a live fest, else the next fest,
 *               else a promotion. `slides` is kept but ignored, so switching
 *               back to curated restores the admin's last list.
 *   curated   — exactly the ordered `slides`, up to five, any mix of fests and
 *               promotions, rotating in that order.
 *
 * A slide is a REFERENCE, never a copy: a fest or promotion edited after it was
 * placed shows its current artwork, and one that is unpublished or ends simply
 * drops out of the public banner (see home-banner-service).
 */
const HOME_BANNER_SETTING_KEY = "home";
const HOME_BANNER_MODES = { AUTOMATIC: "automatic", CURATED: "curated" };
const HOME_BANNER_SLIDE_KINDS = { FEST: "fest", PROMOTION: "promotion" };
/* Research-backed ceiling: past three to five slides almost nobody sees the
   later ones, and each one is more media to load on the first screen. */
const MAXIMUM_HOME_BANNER_SLIDES = 5;

const slideSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: Object.values(HOME_BANNER_SLIDE_KINDS) },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", default: null },
    promotionId: { type: mongoose.Schema.Types.ObjectId, ref: "Promotion", default: null },
  },
  { _id: false }
);

const homeBannerSchema = new mongoose.Schema(
  {
    settingKey: { type: String, required: true, unique: true, default: HOME_BANNER_SETTING_KEY },
    mode: {
      type: String,
      required: true,
      enum: Object.values(HOME_BANNER_MODES),
      default: HOME_BANNER_MODES.AUTOMATIC,
    },
    slides: {
      type: [slideSchema],
      default: [],
      validate: {
        validator: (slides) => slides.length <= MAXIMUM_HOME_BANNER_SLIDES,
        message: `The home banner holds at most ${MAXIMUM_HOME_BANNER_SLIDES} slides.`,
      },
    },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const HomeBannerModel = mongoose.model("HomeBanner", homeBannerSchema, "homeBanners");

module.exports = {
  HomeBannerModel,
  HOME_BANNER_SETTING_KEY,
  HOME_BANNER_MODES,
  HOME_BANNER_SLIDE_KINDS,
  MAXIMUM_HOME_BANNER_SLIDES,
};
