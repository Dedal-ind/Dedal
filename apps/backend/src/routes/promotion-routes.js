const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  getPublishedPromotions,
  getListAllPromotions,
  postCreatePromotion,
  patchPromotion,
  postPublishPromotion,
  postArchivePromotion,
  deletePromotion,
  postReorderPromotions,
} = require("../controllers/promotion-controller");

/*
 * Promotions are platform-wide, so every write is platform-admin only — a
 * college administrator must not be able to put a banner in front of every
 * participant on the platform.
 */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const promotionRouter = express.Router();

/*
 * PUBLIC and unauthenticated: the discover screen is the first thing a
 * signed-out visitor sees. Returns BOTH types keyed by type, so the home
 * screen makes one request rather than one per carousel. Declared before
 * "/:promotionId" so the literal segment cannot be read as an id.
 */
promotionRouter.get("/published", asyncHandler(getPublishedPromotions));

promotionRouter.get("/", ...platformAdminOnly, asyncHandler(getListAllPromotions));
promotionRouter.post("/", ...platformAdminOnly, asyncHandler(postCreatePromotion));
// Literal "reorder" ahead of "/:promotionId" for the same reason.
promotionRouter.post("/reorder", ...platformAdminOnly, asyncHandler(postReorderPromotions));
promotionRouter.patch("/:promotionId", ...platformAdminOnly, asyncHandler(patchPromotion));
promotionRouter.post("/:promotionId/publish", ...platformAdminOnly, asyncHandler(postPublishPromotion));
promotionRouter.post("/:promotionId/archive", ...platformAdminOnly, asyncHandler(postArchivePromotion));
promotionRouter.delete("/:promotionId", ...platformAdminOnly, asyncHandler(deletePromotion));

/*
 * The same public read under /public/promotions, matching the /public/fests
 * namespace the participant app already uses.
 */
const publicPromotionRouter = express.Router();
publicPromotionRouter.get("/", asyncHandler(getPublishedPromotions));

module.exports = { promotionRouter, publicPromotionRouter };
