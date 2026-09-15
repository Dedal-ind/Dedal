const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  getPublicHomeBanner,
  getHomeBannerSetting,
  putHomeBannerSetting,
} = require("../controllers/home-banner-controller");

/*
 * The home banner is platform-wide — what every participant sees first — so
 * reading the editable setting and changing it are platform-admin only, the
 * same gate as promotions.
 */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const homeBannerRouter = express.Router();
homeBannerRouter.get("/", ...platformAdminOnly, asyncHandler(getHomeBannerSetting));
homeBannerRouter.put("/", ...platformAdminOnly, asyncHandler(putHomeBannerSetting));

/* PUBLIC and unauthenticated, like /public/promotions: Discover is the first
   screen a signed-out visitor sees. */
const publicHomeBannerRouter = express.Router();
publicHomeBannerRouter.get("/", asyncHandler(getPublicHomeBanner));

module.exports = { homeBannerRouter, publicHomeBannerRouter };
