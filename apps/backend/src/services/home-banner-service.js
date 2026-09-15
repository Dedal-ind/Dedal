const mongoose = require("mongoose");

const {
  HomeBannerModel,
  HOME_BANNER_SETTING_KEY,
  HOME_BANNER_MODES,
  HOME_BANNER_SLIDE_KINDS,
  MAXIMUM_HOME_BANNER_SLIDES,
} = require("../models/home-banner-model");
const { FestModel } = require("../models/fest-model");
const { PromotionModel, PROMOTION_STATUSES } = require("../models/promotion-model");
const { PUBLICLY_VISIBLE_FEST_STATUSES } = require("../constants/fest-constants");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const { buildPublicFestResponse } = require("./fest-service");
const { toPublicPromotion } = require("./promotion-service");

/*
 * The home banner setting: automatic, or a curated ordered list of up to five
 * fests and promotions (see home-banner-model for the two modes).
 *
 * SAVING checks every slide against what exists NOW — a published, public,
 * not-yet-ended fest, or a published promotion — so the admin cannot place
 * something participants could never be shown. READING for the public
 * re-checks the same rules, because a fest ends and a promotion is archived
 * long after the banner was saved: those slides silently drop out rather than
 * rendering as a broken card, and an emptied curated banner falls back to
 * automatic.
 */

function slideReferenceId(slide) {
  return String(slide.kind === HOME_BANNER_SLIDE_KINDS.FEST ? slide.festId : slide.promotionId);
}

async function loadSetting() {
  return HomeBannerModel.findOne({ settingKey: HOME_BANNER_SETTING_KEY });
}

function isFestShowable(fest, now) {
  return (
    Boolean(fest) &&
    PUBLICLY_VISIBLE_FEST_STATUSES.includes(fest.status) &&
    fest.isSoloContainer !== true &&
    (!fest.endsOn || new Date(fest.endsOn).getTime() >= now)
  );
}

/* Every slide's target, looked up in two queries rather than one per slide. */
async function loadSlideTargets(slides) {
  const festIds = slides
    .filter((slide) => slide.kind === HOME_BANNER_SLIDE_KINDS.FEST)
    .map((slide) => slide.festId);
  const promotionIds = slides
    .filter((slide) => slide.kind === HOME_BANNER_SLIDE_KINDS.PROMOTION)
    .map((slide) => slide.promotionId);

  const [fests, promotions] = await Promise.all([
    festIds.length > 0
      ? FestModel.find({ _id: { $in: festIds } }).populate("hostCollegeId", "commonName city")
      : [],
    promotionIds.length > 0
      ? PromotionModel.find({ _id: { $in: promotionIds } }).lean()
      : [],
  ]);
  return {
    festsById: new Map(fests.map((fest) => [String(fest._id), fest])),
    promotionsById: new Map(promotions.map((promotion) => [String(promotion._id), promotion])),
  };
}

/*
 * Validates the admin's payload into model-ready slides. Throws one
 * VALIDATION_FAILED naming every problem, so the admin fixes them in one pass.
 */
async function parseSlides(rawSlides) {
  if (rawSlides === undefined) {
    return [];
  }
  if (!Array.isArray(rawSlides)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "slides must be an array.", {
      slides: "must be an array",
    });
  }
  if (rawSlides.length > MAXIMUM_HOME_BANNER_SLIDES) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      `The home banner holds at most ${MAXIMUM_HOME_BANNER_SLIDES} slides.`,
      { slides: `at most ${MAXIMUM_HOME_BANNER_SLIDES}` }
    );
  }

  const details = {};
  const slides = [];
  const seen = new Set();
  rawSlides.forEach((rawSlide, index) => {
    const kind = rawSlide?.kind;
    const id = typeof rawSlide?.id === "string" ? rawSlide.id.trim() : "";
    if (!Object.values(HOME_BANNER_SLIDE_KINDS).includes(kind)) {
      details[`slides.${index}.kind`] = "must be fest or promotion";
      return;
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      details[`slides.${index}.id`] = "is not a valid id";
      return;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) {
      details[`slides.${index}`] = "is already in the banner";
      return;
    }
    seen.add(key);
    slides.push({
      kind,
      festId: kind === HOME_BANNER_SLIDE_KINDS.FEST ? id : null,
      promotionId: kind === HOME_BANNER_SLIDE_KINDS.PROMOTION ? id : null,
    });
  });

  const { festsById, promotionsById } = await loadSlideTargets(slides);
  const now = Date.now();
  slides.forEach((slide, index) => {
    const id = slideReferenceId(slide);
    if (slide.kind === HOME_BANNER_SLIDE_KINDS.FEST && !isFestShowable(festsById.get(id), now)) {
      details[`slides.${index}`] = "fest is not published, or has already ended";
    }
    if (
      slide.kind === HOME_BANNER_SLIDE_KINDS.PROMOTION &&
      promotionsById.get(id)?.status !== PROMOTION_STATUSES.PUBLISHED
    ) {
      details[`slides.${index}`] = "promotion is not published";
    }
  });

  if (Object.keys(details).length > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Some banner slides cannot be shown.",
      details
    );
  }
  return slides;
}

/* The admin view: the setting plus each slide's name, so the list reads as
   titles rather than ids, and whether it would currently show. */
async function getHomeBannerSetting() {
  const setting = await loadSetting();
  const mode = setting?.mode ?? HOME_BANNER_MODES.AUTOMATIC;
  const storedSlides = setting?.slides ?? [];
  const { festsById, promotionsById } = await loadSlideTargets(storedSlides);
  const now = Date.now();

  return {
    mode,
    maximumSlides: MAXIMUM_HOME_BANNER_SLIDES,
    updatedAt: setting?.updatedAt ?? null,
    slides: storedSlides.map((slide) => {
      const id = slideReferenceId(slide);
      if (slide.kind === HOME_BANNER_SLIDE_KINDS.FEST) {
        const fest = festsById.get(id);
        return { kind: slide.kind, id, title: fest?.festName ?? null, isShowable: isFestShowable(fest, now) };
      }
      const promotion = promotionsById.get(id);
      return {
        kind: slide.kind,
        id,
        title: promotion?.title ?? null,
        isShowable: promotion?.status === PROMOTION_STATUSES.PUBLISHED,
      };
    }),
  };
}

async function updateHomeBannerSetting(adminUserId, payload, context = {}) {
  const mode = payload?.mode;
  if (!Object.values(HOME_BANNER_MODES).includes(mode)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "mode must be automatic or curated.", {
      mode: "must be automatic or curated",
    });
  }
  const slides = await parseSlides(payload.slides);
  if (mode === HOME_BANNER_MODES.CURATED && slides.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "A curated banner needs at least one slide.",
      { slides: "add at least one fest or promotion" }
    );
  }

  const setting = await HomeBannerModel.findOneAndUpdate(
    { settingKey: HOME_BANNER_SETTING_KEY },
    { $set: { mode, slides, updatedByUserId: adminUserId } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  await recordAuditLog({
    actorUserId: adminUserId,
    // Platform-wide, so there is no fest to scope the row to.
    festId: null,
    action: AUDIT_ACTIONS.HOME_BANNER_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.HOME_BANNER,
    entityId: setting._id,
    afterState: { mode, slides: slides.map((slide) => ({ kind: slide.kind, id: slideReferenceId(slide) })) },
    ...(context || {}),
  });

  return getHomeBannerSetting();
}

/*
 * The participant read. Curated slides are resolved to the SAME shapes the
 * client already renders — a fest exactly as /public/fests returns it, a
 * promotion exactly as /public/promotions returns it — so the hero needs no
 * second renderer.
 */
async function getPublicHomeBanner() {
  const setting = await loadSetting();
  if (!setting || setting.mode !== HOME_BANNER_MODES.CURATED || setting.slides.length === 0) {
    return { mode: HOME_BANNER_MODES.AUTOMATIC, slides: [] };
  }

  const { festsById, promotionsById } = await loadSlideTargets(setting.slides);
  const now = Date.now();
  const slides = [];
  setting.slides.forEach((slide) => {
    const id = slideReferenceId(slide);
    if (slide.kind === HOME_BANNER_SLIDE_KINDS.FEST) {
      const fest = festsById.get(id);
      if (isFestShowable(fest, now)) {
        slides.push({ kind: slide.kind, fest: buildPublicFestResponse(fest) });
      }
      return;
    }
    const promotion = promotionsById.get(id);
    if (promotion?.status === PROMOTION_STATUSES.PUBLISHED) {
      slides.push({ kind: slide.kind, promotion: toPublicPromotion(promotion) });
    }
  });

  // Everything curated has ended or been unpublished: behave as automatic.
  if (slides.length === 0) {
    return { mode: HOME_BANNER_MODES.AUTOMATIC, slides: [] };
  }
  return { mode: HOME_BANNER_MODES.CURATED, slides };
}

module.exports = {
  getHomeBannerSetting,
  updateHomeBannerSetting,
  getPublicHomeBanner,
};
