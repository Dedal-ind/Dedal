const express = require("express");
const multer = require("multer");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getVolunteerSummary,
  getVolunteerHoursSummary,
  getCheckpointParticipantsCsv,
  getCheckpointCheckedInCsv,
  getCheckpointCheckedOutCsv,
  getCheckpointYetToCheckInCsv,
  getCoordinatorEventSummary,
  getCoordinatorParticipantsCsv,
  getCoordinatorCheckedInCsv,
  getCoordinatorCheckedOutCsv,
  getCoordinatorYetToCheckInCsv,
  pushCoordinatorCertificates,
} = require("../controllers/backstage-controller");

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/* Profile reads and edits are user-owned: authentication is the only gate. */
const backstageRouter = express.Router();

backstageRouter.get("/volunteer/summary", authenticationMiddleware, asyncHandler(getVolunteerSummary));
backstageRouter.get(
  "/volunteer/hours-summary",
  authenticationMiddleware,
  asyncHandler(getVolunteerHoursSummary)
);
backstageRouter.get(
  "/volunteer/checkpoints/:checkpointId/participants.csv",
  authenticationMiddleware,
  asyncHandler(getCheckpointParticipantsCsv)
);
backstageRouter.get(
  "/volunteer/checkpoints/:checkpointId/checked-out.csv",
  authenticationMiddleware,
  asyncHandler(getCheckpointCheckedOutCsv)
);

backstageRouter.get(
  "/volunteer/checkpoints/:checkpointId/yet-to-checkin.csv",
  authenticationMiddleware,
  asyncHandler(getCheckpointYetToCheckInCsv)
);

backstageRouter.get(
  "/volunteer/checkpoints/:checkpointId/checked-in.csv",
  authenticationMiddleware,
  asyncHandler(getCheckpointCheckedInCsv)
);

// Coordinator event CSV exports
/*
 * The coordinator event page's stats. The handler existed and was exported but
 * was never mounted, so the page called it and got a 404 on every load.
 */
backstageRouter.get(
  "/coordinator/events/:eventId/summary",
  authenticationMiddleware,
  asyncHandler(getCoordinatorEventSummary)
);

backstageRouter.get(
  "/coordinator/events/:eventId/participants.csv",
  authenticationMiddleware,
  asyncHandler(getCoordinatorParticipantsCsv)
);
backstageRouter.get(
  "/coordinator/events/:eventId/checked-in.csv",
  authenticationMiddleware,
  asyncHandler(getCoordinatorCheckedInCsv)
);
backstageRouter.get(
  "/coordinator/events/:eventId/checked-out.csv",
  authenticationMiddleware,
  asyncHandler(getCoordinatorCheckedOutCsv)
);
backstageRouter.get(
  "/coordinator/events/:eventId/yet-to-checkin.csv",
  authenticationMiddleware,
  asyncHandler(getCoordinatorYetToCheckInCsv)
);

// Push certificates — generates PDFs, saves to DB, emails recipients
backstageRouter.post(
  "/coordinator/events/:eventId/push-certificates",
  authenticationMiddleware,
  templateUpload.single("template"),
  asyncHandler(pushCoordinatorCertificates)
);

module.exports = { backstageRouter };
