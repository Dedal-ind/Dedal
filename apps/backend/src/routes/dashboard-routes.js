const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const { getDashboard } = require("../controllers/dashboard-controller");

/*
 * mergeParams inherits :festId from the mount point. The coordinator-or-admin gate
 * runs event-less here — the route names no event — so any administrator of the
 * fest or active coordinator of it passes, and the service scopes what they see.
 */
const dashboardRouter = express.Router({ mergeParams: true });

const coordinatorOrAdmin = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];

dashboardRouter.get("/", ...coordinatorOrAdmin, asyncHandler(getDashboard));

module.exports = { dashboardRouter };
