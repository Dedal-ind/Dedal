const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  getTargetingOptions,
  postEstimateReach,
  postValidateTargeting,
} = require("../controllers/targeting-controller");

/* Campaign targeting support: platform-admin only, like campaigns themselves. */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const targetingRouter = express.Router();
targetingRouter.get("/options", ...platformAdminOnly, asyncHandler(getTargetingOptions));
targetingRouter.post("/estimate", ...platformAdminOnly, asyncHandler(postEstimateReach));
targetingRouter.post("/validate", ...platformAdminOnly, asyncHandler(postValidateTargeting));

module.exports = { targetingRouter };
