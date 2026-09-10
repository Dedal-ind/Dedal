const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  requirePlatformAdminMiddleware,
} = require("../middleware/require-platform-admin-middleware");
const {
  getAnalyticsSummary,
  getHygieneReport,
  getPlatformAnalytics,
  getExportCounts,
  getRegistrationsCsv,
  getCheckInsCsv,
  getCheckOutsCsv,
  getPaymentsCsv,
  getScansCsv,
  getAuditLogCsv,
  getStaffAssignmentsCsv,
  getStaffAssignmentsExportCount,
  getCertificatesCsv,
  getFeedbackCsv,
} = require("../controllers/analytics-controller");

/*
 * Fest analytics + exports, mounted at /fests/:festId/analytics and
 * /fests/:festId/exports. Coordinator-or-admin like the dashboard (coordinators
 * see only their covered events); the financial/operational/compliance exports
 * are administrator-only — payment refs and audit rows are not a coordinator's
 * to take off the system. :festId is the hard scope of every route here.
 */
const festAnalyticsRouter = express.Router({ mergeParams: true });
const coordinatorOrAdmin = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];
const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];

festAnalyticsRouter.get("/summary", ...coordinatorOrAdmin, asyncHandler(getAnalyticsSummary));
festAnalyticsRouter.get("/hygiene", ...coordinatorOrAdmin, asyncHandler(getHygieneReport));

const festExportsRouter = express.Router({ mergeParams: true });
festExportsRouter.get("/counts", ...coordinatorOrAdmin, asyncHandler(getExportCounts));
festExportsRouter.get("/registrations.csv", ...coordinatorOrAdmin, asyncHandler(getRegistrationsCsv));
// Per-event scan sheets, streamed. Filename: {kind}-{eventSlug}-{yyyymmdd}.csv.
festExportsRouter.get(
  "/events/:eventId/check-ins.csv",
  ...coordinatorOrAdmin,
  asyncHandler(getCheckInsCsv)
);
festExportsRouter.get(
  "/events/:eventId/check-outs.csv",
  ...coordinatorOrAdmin,
  asyncHandler(getCheckOutsCsv)
);
festExportsRouter.get("/payments.csv", ...administratorOnly, asyncHandler(getPaymentsCsv));
festExportsRouter.get("/scans.csv", ...administratorOnly, asyncHandler(getScansCsv));
festExportsRouter.get("/audit-log.csv", ...administratorOnly, asyncHandler(getAuditLogCsv));
festExportsRouter.get("/staff-assignments.csv", ...administratorOnly, asyncHandler(getStaffAssignmentsCsv));
// The download modal's row-count preview, same filter grammar as the CSV above.
festExportsRouter.get(
  "/staff-assignments/count",
  ...administratorOnly,
  asyncHandler(getStaffAssignmentsExportCount)
);
festExportsRouter.get("/certificates.csv", ...administratorOnly, asyncHandler(getCertificatesCsv));
festExportsRouter.get("/feedback.csv", ...administratorOnly, asyncHandler(getFeedbackCsv));

/* Platform-wide analytics — platform admin only. */
const platformAnalyticsRouter = express.Router();
platformAnalyticsRouter.get(
  "/platform",
  authenticationMiddleware,
  requirePlatformAdminMiddleware,
  asyncHandler(getPlatformAnalytics)
);

module.exports = { festAnalyticsRouter, festExportsRouter, platformAnalyticsRouter };
