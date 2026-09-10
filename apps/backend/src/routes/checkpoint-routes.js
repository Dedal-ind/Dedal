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
  getMyCheckpoints,
  getFestCheckpoints,
  postCreateOfferCheckpoint,
  patchCheckpoint,
  postAlertCheckpointVolunteers,
} = require("../controllers/checkpoint-controller");

/*
 * A scanner reads the checkpoints they may operate right now. Authentication is
 * the only gate; the service filters to the caller's own active, in-window staff
 * assignments, so no one sees a checkpoint they cannot scan at.
 */
const checkpointRouter = express.Router();

checkpointRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyCheckpoints));

/*
 * A fest's checkpoints, for the shift picker. mergeParams inherits :festId; the
 * admin-or-coordinator gate scopes a coordinator to the checkpoints they cover.
 */
const festCheckpointRouter = express.Router({ mergeParams: true });

festCheckpointRouter.get(
  "/",
  authenticationMiddleware,
  requireCoordinatorOrAdminMiddleware,
  asyncHandler(getFestCheckpoints)
);

/*
 * Admin-only checkpoint management. There is deliberately NO DELETE route:
 * scans are append-only and every row carries checkpointId, so removal is
 * PATCH { isActive: false } — history preserved.
 */
festCheckpointRouter.post(
  "/",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCreateOfferCheckpoint)
);
festCheckpointRouter.patch(
  "/:checkpointId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(patchCheckpoint)
);

// Notifies every volunteer holding an active shift at this checkpoint.
festCheckpointRouter.post(
  "/:checkpointId/alert-volunteers",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postAlertCheckpointVolunteers)
);

module.exports = { checkpointRouter, festCheckpointRouter };
