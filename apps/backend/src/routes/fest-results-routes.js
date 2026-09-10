const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  getFestResults,
  getFestResultsDownload,
} = require("../controllers/fest-results-controller");

/*
 * The hierarchical results board: one read endpoint whose LEVEL is derived from
 * the ?eventId= scope, and a download that answers at the same level from the
 * same builders.
 *
 * Separate from /results-board, which is the older flat per-event leaderboard
 * list and is left exactly as it was — it is still mounted and still served.
 *
 * Coordinator-or-admin, matching the scoreboard and analytics reads: a
 * coordinator running an event needs the standing they are being asked about in
 * the hall.
 */
const festResultsRouter = express.Router({ mergeParams: true });

const coordinatorOrAdmin = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];

/* Declared before "/" so the literal segment is not swallowed by it. */
festResultsRouter.get("/download", ...coordinatorOrAdmin, asyncHandler(getFestResultsDownload));
festResultsRouter.get("/", ...coordinatorOrAdmin, asyncHandler(getFestResults));

module.exports = { festResultsRouter };
