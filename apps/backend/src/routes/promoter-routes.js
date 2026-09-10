const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  getListPromoters,
  getPromoter,
  postCreatePromoter,
  patchPromoter,
  postArchivePromoter,
  postRestorePromoter,
  getListCreatives,
  getCreative,
  postCreateCreative,
  patchCreative,
  postArchiveCreative,
  postRestoreCreative,
} = require("../controllers/promoter-controller");

/*
 * Promoters and creatives are platform-wide, so every route is platform-admin
 * only — the same composition promotion-routes uses. A college administrator
 * must not be able to create a promoter or put artwork in front of every
 * participant on the platform.
 */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const promoterRouter = express.Router();
promoterRouter.get("/", ...platformAdminOnly, asyncHandler(getListPromoters));
promoterRouter.post("/", ...platformAdminOnly, asyncHandler(postCreatePromoter));
promoterRouter.get("/:promoterId", ...platformAdminOnly, asyncHandler(getPromoter));
promoterRouter.patch("/:promoterId", ...platformAdminOnly, asyncHandler(patchPromoter));
promoterRouter.post("/:promoterId/archive", ...platformAdminOnly, asyncHandler(postArchivePromoter));
promoterRouter.post("/:promoterId/restore", ...platformAdminOnly, asyncHandler(postRestorePromoter));

/* Creatives: listed by promoter (?promoterId= is required), managed by id. */
const creativeRouter = express.Router();
creativeRouter.get("/", ...platformAdminOnly, asyncHandler(getListCreatives));
creativeRouter.post("/", ...platformAdminOnly, asyncHandler(postCreateCreative));
creativeRouter.get("/:creativeId", ...platformAdminOnly, asyncHandler(getCreative));
creativeRouter.patch("/:creativeId", ...platformAdminOnly, asyncHandler(patchCreative));
creativeRouter.post("/:creativeId/archive", ...platformAdminOnly, asyncHandler(postArchiveCreative));
creativeRouter.post("/:creativeId/restore", ...platformAdminOnly, asyncHandler(postRestoreCreative));

module.exports = { promoterRouter, creativeRouter };
