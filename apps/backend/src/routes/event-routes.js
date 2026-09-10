const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  getNotifyParticipantsPreview,
  postNotifyParticipants,
  postBroadcastMessage,
  postInAppBroadcast,
  getRoundParticipantsCsv,
} = require("../controllers/event-notification-controller");
const { getEventDirectory } = require("../controllers/event-controller");
const {
  patchMoveEvent,
  patchReorderEvents,
} = require("../controllers/event-structure-controller");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  postPushWinnerCertificates,
  postPushParticipationCertificates,
} = require("../controllers/results-board-controller");
const {
  postCreateRound,
  postStartRound,
  getListRounds,
  getRoundDetail,
  patchRound,
  postDeleteRounds,
  postAdvanceParticipants,
  postEliminateParticipants,
  postAwardRoundResults,
  postFinaliseResults,
  postRetractParticipants,
  postRoundScores,
  getRoundScoreboard,
  patchRoundScoreAsAdministrator,
  postRoundDocument,
  roundDocumentUploadMiddleware,
  getEventOverviewStats,
} = require("../controllers/round-controller");
const {
  postCreateEvent,
  getListPublicEvents,
  getListAllEventsForAdmin,
  getEventById,
  getEventParticipants,
  getEventScanParticipants,
  patchUpdateEvent,
  postPublishEvent,
  postCloseEventRegistration,
  postReopenEventRegistration,
  postReopenCancelledEvent,
  deleteEventSoftHandler,
  deleteEventHandler,
  postCancelEvent,
  getCancelEventPreview,
} = require("../controllers/event-controller");
const {
  postGenerateBracket,
  postForceRegenerateBracket,
  getBracket,
  patchMatch,
  postScoresheet,
} = require("../controllers/bracket-controller");
const { getEventStaffRoster } = require("../controllers/fest-staff-controller");
const { getLiveEventStaff } = require("../controllers/live-staff-controller");
const {
  getLeaderboard,
  postInitializeScores,
  patchScore,
  postFinalizeScores,
  getScore,
} = require("../controllers/score-controller");
const { getCheckoutSummary } = require("../controllers/payment-controller");
const { postAwardResults } = require("../controllers/achievement-controller");

/*
 * mergeParams inherits :festId from the mount point. Without it, every handler
 * and the authorisation middleware would see an empty params object and the fest
 * lookup would fail.
 */
const eventRouter = express.Router({ mergeParams: true });

const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];
const coordinatorOrAdmin = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];

eventRouter.post("/", ...administratorOnly, asyncHandler(postCreateEvent));

// Public: anyone with the link sees the events a fest has published.
eventRouter.get("/", asyncHandler(getListPublicEvents));

/*
 * Declared before "/:eventId", otherwise Express matches "all" as an eventId and
 * this route becomes unreachable.
 */
eventRouter.get("/all", ...administratorOnly, asyncHandler(getListAllEventsForAdmin));

/*
 * Structure editor. "reorder" is a literal segment and must be declared ahead of
 * "/:eventId/..." for the same reason "/all" is above — otherwise Express binds
 * it as an eventId and the bulk endpoint is unreachable.
 */
/*
 * RETAINED WITHOUT A CALLER. The structure editor's drop moves exactly one row
 * and goes through /:eventId/move; nothing in the client calls /reorder today.
 * It is kept deliberately for a future multi-row drag (a marquee selection
 * dropped as one batch). Do not remove it as dead code, and do not assume it
 * is exercised in production — its coverage is its unit tests alone.
 */
eventRouter.patch("/reorder", ...administratorOnly, asyncHandler(patchReorderEvents));
eventRouter.patch("/:eventId/move", ...administratorOnly, asyncHandler(patchMoveEvent));

// Reading and editing one event is open to the fest's coordinators, not only admins.
eventRouter.get("/:eventId", ...coordinatorOrAdmin, asyncHandler(getEventById));
eventRouter.patch("/:eventId", ...coordinatorOrAdmin, asyncHandler(patchUpdateEvent));

eventRouter.post("/:eventId/publish", ...administratorOnly, asyncHandler(postPublishEvent));
/* Manual registration close/reopen. Non-destructive: stamps one field, touches
 * no registration. Administrator-only, like publish. */
eventRouter.post("/:eventId/registration/close", ...administratorOnly, asyncHandler(postCloseEventRegistration));
eventRouter.post("/:eventId/registration/reopen", ...administratorOnly, asyncHandler(postReopenEventRegistration));
/*
 * The same two actions under the names the Event Access console calls, and at
 * the COORDINATOR gate rather than the administrator one.
 *
 * Two paths for one action is a cost, taken deliberately: the /registration/*
 * pair is already live and deep-linked, and silently moving it would break
 * whatever still calls it. They share a handler, so the two can never behave
 * differently — this is an alias, not a second implementation.
 *
 * The widened gate is the real change: closing sign-ups for one event is an
 * operational decision the person running that event has to be able to make
 * without finding an administrator, and it destroys nothing (one field, fully
 * reversible by the twin below). Cancel and delete stay administrator-only,
 * because those are not reversible.
 */
eventRouter.post("/:eventId/close-registration", ...coordinatorOrAdmin, asyncHandler(postCloseEventRegistration));
eventRouter.post("/:eventId/reopen-registration", ...coordinatorOrAdmin, asyncHandler(postReopenEventRegistration));
/* Reopen a cancelled event as a fresh draft. Requires the full new schedule in
 * the body; never resurrects the cancelled registrations. */
eventRouter.post("/:eventId/reopen", ...administratorOnly, asyncHandler(postReopenCancelledEvent));
/*
 * DELETE has two meanings and therefore two routes.
 *
 * "/:eventId" is the HARD delete: it physically removes the document and is
 * refused the moment one registration exists. It is kept for the case it is
 * genuinely right for — an event created by mistake that nobody ever touched.
 *
 * "/:eventId/soft" is the WITHDRAWAL: the event stops appearing to participants
 * and stops taking sign-ups, everything already attached to it (registrations,
 * payments, teams, passes) is left exactly as it is, and the people who had
 * registered are told. This is what the Event Access console's "Delete Event"
 * calls, because an organiser saying "delete" about a live event means "take it
 * down", not "orphan two hundred passes".
 */
eventRouter.delete("/:eventId", ...administratorOnly, asyncHandler(deleteEventHandler));
eventRouter.delete("/:eventId/soft", ...administratorOnly, asyncHandler(deleteEventSoftHandler));
/*
 * Preview first, cancel second, two routes. A cancellation preview must never be
 * reachable through the same verb+path as the cancellation itself.
 */
eventRouter.get(
  "/:eventId/cancel-preview",
  ...administratorOnly,
  asyncHandler(getCancelEventPreview)
);
eventRouter.post("/:eventId/cancel", ...administratorOnly, asyncHandler(postCancelEvent));

// Coordinator surfaces: roster, bracket generation, result entry and scoresheets.
eventRouter.get("/:eventId/participants", ...coordinatorOrAdmin, asyncHandler(getEventParticipants));
// Same gate as the participants roster: the scan drill-down is the same audience.
eventRouter.get("/:eventId/scans", ...coordinatorOrAdmin, asyncHandler(getEventScanParticipants));

/*
 * The live staff snapshot. The middleware admits any coordinator of this fest;
 * the service then narrows them to the event their assignment covers.
 */
eventRouter.get("/:eventId/live-staff", ...coordinatorOrAdmin, asyncHandler(getLiveEventStaff));

// Past + present staff on this event; a coordinator of the event may read it too.
eventRouter.get("/:eventId/staff", ...coordinatorOrAdmin, asyncHandler(getEventStaffRoster));
eventRouter.post(
  "/:eventId/generate-bracket",
  ...administratorOnly,
  asyncHandler(postGenerateBracket)
);
/*
 * Burying a played bracket is an administrator act, so this takes the
 * administrator gate rather than the coordinator one the generate route above
 * uses. A coordinator who taps generate on a live bracket is refused and told an
 * administrator can override; there is no path from that refusal to here.
 */
eventRouter.post(
  "/:eventId/bracket/force-regenerate",
  ...administratorOnly,
  asyncHandler(postForceRegenerateBracket)
);

eventRouter.patch(
  "/:eventId/matches/:matchId",
  ...coordinatorOrAdmin,
  asyncHandler(patchMatch)
);
eventRouter.post(
  "/:eventId/matches/:matchId/scoresheet",
  ...coordinatorOrAdmin,
  asyncHandler(postScoresheet)
);

/*
 * The bracket is readable by any authenticated user — a participant checks their
 * own position too — so it takes only the authentication gate, not the coordinator
 * one. Placed last; its literal "bracket" segment cannot be mistaken for a match id.
 */
eventRouter.get("/:eventId/bracket", authenticationMiddleware, asyncHandler(getBracket));

/*
 * Live leaderboard for non-bracket events. The read is public (the frontend polls
 * it for live updates); the writes are coordinator/admin, and finalize is admin
 * only. Literal "scores/initialize" and "scores/finalize" cannot be mistaken for a
 * registrationId under a different method.
 */
// Read-only fee preview before registering; authentication only, creates no rows.
eventRouter.get("/:eventId/checkout-summary", authenticationMiddleware, asyncHandler(getCheckoutSummary));

eventRouter.get("/:eventId/leaderboard", asyncHandler(getLeaderboard));
eventRouter.post("/:eventId/scores/initialize", ...coordinatorOrAdmin, asyncHandler(postInitializeScores));
eventRouter.post("/:eventId/scores/finalize", ...administratorOnly, asyncHandler(postFinalizeScores));
eventRouter.patch("/:eventId/scores/:registrationId", ...coordinatorOrAdmin, asyncHandler(patchScore));
eventRouter.get("/:eventId/scores/:registrationId", ...coordinatorOrAdmin, asyncHandler(getScore));

/*
 * The coordinator's multi-round judging flow. Coordinator-or-admin throughout —
 * the middleware scopes a coordinator to the events their assignment covers, so
 * a coordinator of event A cannot touch event B's rounds. Nothing here is
 * admin-only: running rounds IS the coordinator's job.
 */
eventRouter.get("/:eventId/overview-stats", ...coordinatorOrAdmin, asyncHandler(getEventOverviewStats));

/*
 * Bulk message to every confirmed registrant. The preview is a separate GET so
 * the modal can show the recipient count and the remaining daily budget before
 * the coordinator commits to anything.
 */
eventRouter.get(
  "/:eventId/notify-participants",
  ...coordinatorOrAdmin,
  asyncHandler(getNotifyParticipantsPreview)
);
eventRouter.post(
  "/:eventId/notify-participants",
  ...coordinatorOrAdmin,
  asyncHandler(postNotifyParticipants)
);

/*
 * Admin broadcast: one message to a chosen audience (participants, staff, or
 * both) of one event. Service and controller were written but the route was
 * never mounted, so the admin broadcast screen posted into a 404 and every
 * send failed. administratorOnly per the controller's own contract — a
 * coordinator reaches their event through notify-participants above.
 */
/*
 * The coordinator's in-app broadcast. Separate verb from /broadcast above,
 * which is admin-only and sends email — different audience, different channel,
 * different permission.
 */
/*
 * The directory: the one participant read that includes phone numbers, so it
 * sits behind the same coordinator gate as broadcast — never public.
 */
eventRouter.get(
  "/:eventId/directory",
  ...coordinatorOrAdmin,
  asyncHandler(getEventDirectory)
);

eventRouter.post(
  "/:eventId/broadcast-in-app",
  ...coordinatorOrAdmin,
  asyncHandler(postInAppBroadcast)
);

eventRouter.post(
  "/:eventId/broadcast",
  ...administratorOnly,
  asyncHandler(postBroadcastMessage)
);
eventRouter.post("/:eventId/rounds", ...coordinatorOrAdmin, asyncHandler(postCreateRound));
eventRouter.get("/:eventId/rounds", ...coordinatorOrAdmin, asyncHandler(getListRounds));
eventRouter.post("/:eventId/rounds/delete", ...coordinatorOrAdmin, asyncHandler(postDeleteRounds));

/*
 * Start: freezes the roster, makes the round live on the scoreboard, and emails
 * the brief to its participants. One irreversible step, so it is its own verb
 * rather than a status PATCH.
 */
eventRouter.post(
  "/:eventId/rounds/:roundId/start",
  ...coordinatorOrAdmin,
  asyncHandler(postStartRound)
);
/* Literal "scoreboard" — mounted ABOVE /rounds/:roundId so it can never be
 * matched as a round id. */
eventRouter.get("/:eventId/rounds/scoreboard", ...coordinatorOrAdmin, asyncHandler(getRoundScoreboard));
eventRouter.get("/:eventId/rounds/:roundId", ...coordinatorOrAdmin, asyncHandler(getRoundDetail));
eventRouter.patch("/:eventId/rounds/:roundId", ...coordinatorOrAdmin, asyncHandler(patchRound));
eventRouter.post(
  "/:eventId/rounds/:roundId/advance",
  ...coordinatorOrAdmin,
  asyncHandler(postAdvanceParticipants)
);
/*
 * Elimination that the certificate pipeline can see. advance/ only moves people
 * into the next round; this also stamps ELIMINATED on the rest, which is what
 * decides who gets a participation certificate.
 */
eventRouter.post(
  "/:eventId/rounds/:roundId/eliminate",
  ...coordinatorOrAdmin,
  asyncHandler(postEliminateParticipants)
);

/*
 * Awards placements from the rounds' total scores. The existing
 * /award-results reads the BRACKET and is admin-only; a coordinator running a
 * scored multi-round event had no way to produce the achievement rows the
 * winner-certificate push looks for.
 */
/*
 * Finalise: awards medals, stamps the event, locks every score. One verb
 * because it is one irreversible decision.
 */
eventRouter.post(
  "/:eventId/rounds/finalise",
  ...coordinatorOrAdmin,
  asyncHandler(postFinaliseResults)
);

eventRouter.post(
  "/:eventId/rounds/award-results",
  ...coordinatorOrAdmin,
  asyncHandler(postAwardRoundResults)
);

eventRouter.post(
  "/:eventId/rounds/:roundId/retract",
  ...coordinatorOrAdmin,
  asyncHandler(postRetractParticipants)
);
eventRouter.post("/:eventId/rounds/:roundId/scores", ...coordinatorOrAdmin, asyncHandler(postRoundScores));

/*
 * The admin result board. Two verbs, two different gates on purpose.
 *
 * The READ is coordinator-or-admin: a coordinator looking at the board of an
 * event they cover is reading their own sheet, laid out by round.
 *
 * The WRITE is administratorOnly. setRoundScoreAsAdministrator deliberately
 * bypasses the presence gate and the finalise lock that saveRoundScores
 * enforces, so a coordinator reaching it would be a way around both — the
 * coordinator's own path stays /rounds/:roundId/scores, unchanged.
 *
 * Mounted BEFORE "/:eventId/rounds/:roundId" so the literal "scoreboard"
 * segment can never be read as a roundId.
 */
eventRouter.patch(
  "/:eventId/rounds/:roundId/scores/:participantUserId",
  ...administratorOnly,
  asyncHandler(patchRoundScoreAsAdministrator)
);
/* The round sheet the coordinator carries into the hall. */
eventRouter.get(
  "/:eventId/rounds/:roundId/participants.csv",
  ...coordinatorOrAdmin,
  asyncHandler(getRoundParticipantsCsv)
);
// multer parses the multipart body before the handler runs.
eventRouter.post(
  "/:eventId/rounds/:roundId/upload-document",
  ...coordinatorOrAdmin,
  roundDocumentUploadMiddleware,
  asyncHandler(postRoundDocument)
);

// Awards eventResult achievements from the event's finalized bracket or scores. Admin only.
eventRouter.post("/:eventId/award-results", ...administratorOnly, asyncHandler(postAwardResults));

/*
 * The results board's two explicit certificate pushes: winners (from awarded
 * placements) and participation (all standing registrants). Admin only —
 * deliberately not offered to coordinators (their prompt-13 generic
 * generate/release flow is unchanged).
 */
eventRouter.post(
  "/:eventId/certificates/push-winners",
  ...administratorOnly,
  asyncHandler(postPushWinnerCertificates)
);
eventRouter.post(
  "/:eventId/certificates/push-participation",
  ...administratorOnly,
  asyncHandler(postPushParticipationCertificates)
);

module.exports = { eventRouter };
