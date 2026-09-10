const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const controller = require("../controllers/delivery-reporting-controller");

/*
 * GET /reports/delivery/platform
 * GET /reports/delivery/campaigns/:campaignId
 * GET /reports/delivery/campaigns/:campaignId/creatives
 * GET /reports/delivery/placements/:placementKey
 * GET /reports/delivery/promoters/:promoterId
 *
 * Platform admin only, like platform analytics. Literal "platform" is
 * declared first; the rest are namespaced so nothing is read as an id.
 */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const deliveryReportingRouter = express.Router();
deliveryReportingRouter.get("/platform", ...platformAdminOnly, asyncHandler(controller.getPlatformOverview));
deliveryReportingRouter.get("/campaigns/:campaignId", ...platformAdminOnly, asyncHandler(controller.getCampaignReport));
deliveryReportingRouter.get(
  "/campaigns/:campaignId/creatives",
  ...platformAdminOnly,
  asyncHandler(controller.getCampaignCreativesReport)
);
deliveryReportingRouter.get("/placements/:placementKey", ...platformAdminOnly, asyncHandler(controller.getPlacementReport));
deliveryReportingRouter.get("/promoters/:promoterId", ...platformAdminOnly, asyncHandler(controller.getPromoterSummary));

module.exports = { deliveryReportingRouter };
