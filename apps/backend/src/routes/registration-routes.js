const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  getAvailableAddOns,
  postRegistrationAddOns,
} = require("../controllers/add-on-controller");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  postRegisterSolo,
  postRegisterTeam,
  postConfirmPayment,
  postCancelMyRegistration,
  postCancelMyPendingRegistration,
  postCancelRegistration,
  postJoinTeam,
  getListMyRegistrations,
  getMyRegistrationById,
} = require("../controllers/registration-controller");

/*
 * Registrations are user-owned actions, so authentication is the only gate — no
 * administrator middleware. mergeParams inherits :eventId from the mount point.
 */
const eventRegistrationRouter = express.Router({ mergeParams: true });

eventRegistrationRouter.post("/solo", authenticationMiddleware, asyncHandler(postRegisterSolo));
eventRegistrationRouter.post("/team", authenticationMiddleware, asyncHandler(postRegisterTeam));
eventRegistrationRouter.post(
  "/mine/cancel",
  authenticationMiddleware,
  asyncHandler(postCancelMyRegistration)
);
/*
 * Releasing an unpaid hold this caller left behind, so the form can be retried
 * after a failed paid attempt. Distinct from /mine/cancel, which only reaches a
 * confirmed seat within the self-cancellation window.
 */
eventRegistrationRouter.post(
  "/mine/cancel-pending",
  authenticationMiddleware,
  asyncHandler(postCancelMyPendingRegistration)
);

/*
 * Mounted at the top level: a participant reads their own registrations across
 * every event. "/mine" is declared before "/:registrationId" so it is not
 * swallowed as an id.
 */
const myRegistrationRouter = express.Router();

myRegistrationRouter.get("/mine", authenticationMiddleware, asyncHandler(getListMyRegistrations));

/*
 * Joining a forming team by its invite code takes a seat, so it sits with the
 * other seat-taking actions. Declared before "/:registrationId" so the literal
 * path is not read as an id.
 */
myRegistrationRouter.post("/mine/join-team", authenticationMiddleware, asyncHandler(postJoinTeam));

/*
 * The manual payment-confirmation stand-in for the future gateway webhook.
 * Authentication only at the route; the service scopes it to an administrator of
 * the group's fest, since the fest is only known once the group is loaded. Declared
 * before "/:registrationId" so the literal path is not read as an id.
 */
myRegistrationRouter.post(
  "/confirm-payment",
  authenticationMiddleware,
  asyncHandler(postConfirmPayment)
);

/*
 * Cancellation, for any actor. Authentication is the only middleware: which
 * policy applies — the participant's own bounded window, or a coordinator's or
 * administrator's unbounded override — is derived in the service from who the
 * caller is to this row. Declared before "/:registrationId" so it is not read as an id.
 */
myRegistrationRouter.post(
  "/:registrationId/cancel",
  authenticationMiddleware,
  asyncHandler(postCancelRegistration)
);
/*
 * Add-ons on an EXISTING registration — the path for somebody who joined by
 * invite code and so never saw the registration form's offer step. Declared
 * before "/:registrationId" so the literal segment is not swallowed as an id.
 */
myRegistrationRouter.get(
  "/:registrationId/add-ons",
  authenticationMiddleware,
  asyncHandler(getAvailableAddOns)
);
myRegistrationRouter.post(
  "/:registrationId/add-ons",
  authenticationMiddleware,
  asyncHandler(postRegistrationAddOns)
);
myRegistrationRouter.get(
  "/:registrationId",
  authenticationMiddleware,
  asyncHandler(getMyRegistrationById)
);

module.exports = { eventRegistrationRouter, myRegistrationRouter };
