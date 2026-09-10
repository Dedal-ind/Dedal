const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const { getResultsBoard } = require("../controllers/results-board-controller");

/*
 * The consolidated results board: every event of the fest with its leaderboard
 * (or bracket winner). Read-only, coordinator-or-admin scoped like the
 * analytics summary. The certificate PUSH actions are NOT here — they live on
 * the event router, admin-only.
 */
const festResultsBoardRouter = express.Router({ mergeParams: true });

festResultsBoardRouter.get(
  "/",
  authenticationMiddleware,
  requireCoordinatorOrAdminMiddleware,
  asyncHandler(getResultsBoard)
);

module.exports = { festResultsBoardRouter };
