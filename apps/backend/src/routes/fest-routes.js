const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
// PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
const {
  requirePurgeEnvironmentMiddleware,
} = require("../middleware/require-purge-environment-middleware");
const {
  deleteFestHandler,
  postCreateFest,
  getMyFests,
  getFestById,
  patchUpdateFest,
  postArchiveFest,
  postCancelFest,
  getCancelFestPreview,
  postPublishFest,
  postUnarchiveFest,
  getFestParticipants,
  getStaffDirectory,
  // PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
  getPurgeFestPreview,
  deletePurgeFest,
} = require("../controllers/fest-controller");

const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  postCloseFestRegistration,
  postReopenFestRegistration,
} = require("../controllers/event-controller");
const {
  postFestBroadcastMessage,
} = require("../controllers/event-notification-controller");
const {
  getFestGateStats,
  getFestGateActivity,
  getFestOffers,
  getOfferStats,
} = require("../controllers/campus-access-controller");

const festRouter = express.Router();

festRouter.post(
  "/",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCreateFest)
);

/*
 * Declared before "/:festId", otherwise Express matches "mine" as a festId and
 * this route becomes unreachable.
 */
festRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyFests));

/*
 * The administrator's own view of a fest, drafts included. Participants read a
 * published fest through /api/v1/public/fests/:festId, which hides drafts and
 * archived fests — so this endpoint is gated to the college's administrator.
 */
festRouter.get(
  "/:festId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getFestById)
);

festRouter.patch(
  "/:festId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(patchUpdateFest)
);

festRouter.post(
  "/:festId/archive",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postArchiveFest)
);

// One-way: a solo container fest (independent-event wrapper) becomes an
// ordinary fest the admin can rename and add events to.
festRouter.post(
  "/:festId/convert-to-full-fest",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(async (request, response) => {
    const independentEventService = require("../services/independent-event-service");
    const { extractRequestContext } = require("../helpers/request-context");
    const fest = await independentEventService.convertSoloContainerToFullFest(
      request.authenticatedUser.userId,
      request.params.festId,
      extractRequestContext(request)
    );
    return response.status(200).json({ data: fest });
  })
);

/*
 * Cancelling the whole fest: cascades every event, notifies every participant,
 * marks captured payments refund-pending. Irreversible — there is deliberately no
 * un-cancel route. The preview above it is what the console reads first.
 */
festRouter.get(
  "/:festId/cancel-preview",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getCancelFestPreview)
);

festRouter.post(
  "/:festId/cancel",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCancelFest)
);

/*
 * The fest-wide broadcast. administratorOnly, matching the per-event
 * /events/:eventId/broadcast it sits beside - a coordinator's reach is their
 * own events, and "every participant of the fest" is not that.
 *
 * It is mounted HERE rather than on the event router because it has no event:
 * hanging it off an arbitrary :eventId would make the audit trail claim a
 * fest-wide announcement belonged to one event.
 */
festRouter.post(
  "/:festId/broadcast",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postFestBroadcastMessage)
);

festRouter.post(
  "/:festId/publish",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postPublishFest)
);

festRouter.post(
  "/:festId/unarchive",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postUnarchiveFest)
);

/*
 * The admin User Directory feed: every unique participant across the fest's
 * events, folded into one row each. Administrator-gated at both layers.
 */
festRouter.get(
  "/:festId/participants",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getFestParticipants)
);

/*
 * The staff directory: authentication is the only middleware gate. Who may read it
 * (fest staff or a confirmed participant) and whether phone numbers are visible are
 * data-scoped decisions the service makes, not a role gate.
 */
festRouter.get(
  "/:festId/staff-directory",
  authenticationMiddleware,
  asyncHandler(getStaffDirectory)
);

/*
 * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
 *
 * The environment gate runs FIRST, before authentication even: in production the
 * request is refused with 403 PURGE_NOT_ALLOWED_IN_ENVIRONMENT having touched
 * nothing. There is deliberately no purge-all-fests route — the blast radius of
 * one accidental request must never exceed one fest.
 */
festRouter.get(
  "/:festId/purge-preview",
  requirePurgeEnvironmentMiddleware,
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getPurgeFestPreview)
);

/* Hard delete — zero-registration fests only; guarded in the service. */
festRouter.delete(
  "/:festId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(deleteFestHandler)
);

festRouter.delete(
  "/:festId/purge",
  requirePurgeEnvironmentMiddleware,
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(deletePurgeFest)
);

/*
 * CAMPUS ACCESS AND OFFER UTILISATION — read-only dashboards.
 *
 * Gate STATS are admin-only: "how many people are on campus right now" is an
 * operations figure for whoever runs the fest, not for everyone holding a
 * scanner. Gate ACTIVITY is coordinator-or-admin because it is what the gate
 * team's own dashboard shows them — today's tally and the last few faces
 * through the door, so they can see their scanner is actually recording.
 *
 * Both are mounted above the "/:festId" DELETE below only for readability; the
 * paths carry distinct literal segments, so ordering is not load-bearing here.
 */
festRouter.get(
  "/:festId/gate-stats",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getFestGateStats)
);

festRouter.get(
  "/:festId/gate-activity",
  authenticationMiddleware,
  requireCoordinatorOrAdminMiddleware,
  asyncHandler(getFestGateActivity)
);

/* The offers dashboard: the fest's offer catalogue, then one offer's numbers.
 * "offers" is a literal segment and cannot collide with any id parameter. */
festRouter.get(
  "/:festId/offers",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getFestOffers)
);

festRouter.get(
  "/:festId/offers/:offerId/stats",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getOfferStats)
);

/*
 * FEST-WIDE registration close/reopen. The same field the per-event action
 * writes, applied across every event of the fest at once — the case the
 * per-event switch cannot serve is closing a twenty-event fest an hour before it
 * starts, where the one event an admin misses is the one still taking sign-ups.
 *
 * Administrator-only, unlike the per-event twins: this reaches events the caller
 * may not individually coordinate. Reopen deliberately skips cancelled and
 * deleted events and reports how many it skipped.
 */
festRouter.post(
  "/:festId/close-registration",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCloseFestRegistration)
);

festRouter.post(
  "/:festId/reopen-registration",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postReopenFestRegistration)
);

module.exports = { festRouter };
