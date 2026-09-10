const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const controller = require("../controllers/campaign-controller");

/* Platform-wide, platform-admin only — the same composition as promoters. */
const platformAdminOnly = [authenticationMiddleware, requirePlatformAdminMiddleware];

const campaignRouter = express.Router();

campaignRouter.get("/", ...platformAdminOnly, asyncHandler(controller.getListCampaigns));
campaignRouter.post("/", ...platformAdminOnly, asyncHandler(controller.postCreateCampaign));
campaignRouter.get("/:campaignId", ...platformAdminOnly, asyncHandler(controller.getCampaign));
campaignRouter.patch("/:campaignId", ...platformAdminOnly, asyncHandler(controller.patchCampaign));
campaignRouter.delete("/:campaignId", ...platformAdminOnly, asyncHandler(controller.deleteCampaign));
campaignRouter.post("/:campaignId/publish", ...platformAdminOnly, asyncHandler(controller.postPublishCampaign));
campaignRouter.post("/:campaignId/pause", ...platformAdminOnly, asyncHandler(controller.postPauseCampaign));
campaignRouter.post("/:campaignId/resume", ...platformAdminOnly, asyncHandler(controller.postResumeCampaign));
campaignRouter.post("/:campaignId/archive", ...platformAdminOnly, asyncHandler(controller.postArchiveCampaign));

/* The creative associations of one campaign. */
campaignRouter.post("/:campaignId/creatives", ...platformAdminOnly, asyncHandler(controller.postAttachCreative));
campaignRouter.patch("/:campaignId/creatives/:creativeId", ...platformAdminOnly, asyncHandler(controller.patchAssociation));
campaignRouter.delete("/:campaignId/creatives/:creativeId", ...platformAdminOnly, asyncHandler(controller.deleteAssociation));

module.exports = { campaignRouter };
