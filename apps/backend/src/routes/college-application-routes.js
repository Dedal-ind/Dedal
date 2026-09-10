const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  postSubmitApplication,
  getApplicationStatus,
  getListApplications,
  getApplicationById,
  postApproveApplication,
  postRejectApplication,
} = require("../controllers/college-application-controller");

/*
 * Public router, mounted at /api/v1/college-applications. Submission and status
 * polling take no authentication — the applicant has no account yet; abuse is
 * bounded by the per-IP rate limit and the PII-free status projection.
 */
const collegeApplicationRouter = express.Router();

collegeApplicationRouter.post("/", asyncHandler(postSubmitApplication));
collegeApplicationRouter.get("/status/:applicationId", asyncHandler(getApplicationStatus));

/*
 * Review router, mounted under /api/v1/admin so the final paths are
 * /api/v1/admin/college-applications[...]. Platform owner only.
 */
const adminCollegeApplicationRouter = express.Router();

/*
 * Gated per-route rather than with router.use: the /api/v1/admin prefix is
 * shared with the audit-log router, and a router-level use() would also run for
 * paths this router does not handle.
 */
const platformAdminGate = [authenticationMiddleware, requirePlatformAdminMiddleware];

adminCollegeApplicationRouter.get(
  "/college-applications",
  platformAdminGate,
  asyncHandler(getListApplications)
);
adminCollegeApplicationRouter.get(
  "/college-applications/:applicationId",
  platformAdminGate,
  asyncHandler(getApplicationById)
);
adminCollegeApplicationRouter.post(
  "/college-applications/:applicationId/approve",
  platformAdminGate,
  asyncHandler(postApproveApplication)
);
adminCollegeApplicationRouter.post(
  "/college-applications/:applicationId/reject",
  platformAdminGate,
  asyncHandler(postRejectApplication)
);

module.exports = { collegeApplicationRouter, adminCollegeApplicationRouter };
