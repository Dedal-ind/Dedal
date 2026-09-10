const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  postCreateContingent,
  patchUpdateContingent,
  postPublishContingent,
  postCancelContingent,
  getListFestContingents,
  getContingentDetail,
  getPublicContingentsForEvent,
  postPurchaseContingent,
  getMyContingentClaims,
  getMyContingentPurchases,
  postAcceptContingentClaim,
  postDeclineContingentClaim,
  postCancelContingentPurchase,
  getInspectInviteCode,
  postRedeemVerticalCode,
  getPurchaseVerticalCodes,
  getContingentVerticalCodes,
} = require("../controllers/contingent-controller");

/*
 * Admin CRUD plus the buyer's purchase, mounted at
 * /api/v1/fests/:festId/contingents. There is deliberately NO DELETE route — a
 * purchased contingent is CANCELLED, never removed (C.6). The purchase endpoint
 * is authentication-only: any participant may buy.
 */
const festContingentRouter = express.Router({ mergeParams: true });

festContingentRouter.post(
  "/",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCreateContingent)
);
festContingentRouter.get(
  "/",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getListFestContingents)
);
festContingentRouter.get(
  "/:contingentId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getContingentDetail)
);
/* Admin's per-vertical usage table: every code minted under this contingent. */
festContingentRouter.get(
  "/:contingentId/vertical-codes",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(getContingentVerticalCodes)
);
festContingentRouter.patch(
  "/:contingentId",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(patchUpdateContingent)
);
festContingentRouter.post(
  "/:contingentId/publish",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postPublishContingent)
);
festContingentRouter.post(
  "/:contingentId/cancel",
  authenticationMiddleware,
  requireAdministratorMiddleware,
  asyncHandler(postCancelContingent)
);
festContingentRouter.post(
  "/:contingentId/purchase",
  authenticationMiddleware,
  asyncHandler(postPurchaseContingent)
);

/*
 * The participant-facing published bundles for one parent event. Public in the
 * same sense as /api/v1/public/fests — no authentication, published data only.
 */
const publicContingentRouter = express.Router({ mergeParams: true });
publicContingentRouter.get("/", asyncHandler(getPublicContingentsForEvent));

/*
 * The attendee's own claims (accept/decline) and the buyer's own purchases
 * (list/cancel). "mine" is declared before ":claimId" so it is not read as an id.
 */
const contingentClaimRouter = express.Router();
contingentClaimRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyContingentClaims));
contingentClaimRouter.post(
  "/:claimId/accept",
  authenticationMiddleware,
  asyncHandler(postAcceptContingentClaim)
);
contingentClaimRouter.post(
  "/:claimId/decline",
  authenticationMiddleware,
  asyncHandler(postDeclineContingentClaim)
);

/*
 * The join box. Both routes are authentication-only: any signed-in participant
 * may look up a code they were handed. inspect takes the code in the PATH and
 * redeem takes it in the BODY, because only the second one changes anything and
 * should not sit in a URL that ends up in server logs or a browser history.
 */
const inviteCodeRouter = express.Router();
inviteCodeRouter.get(
  "/:inviteCode/inspect",
  authenticationMiddleware,
  asyncHandler(getInspectInviteCode)
);
inviteCodeRouter.post("/redeem", authenticationMiddleware, asyncHandler(postRedeemVerticalCode));

const contingentPurchaseRouter = express.Router();
/* The buyer's own codes, for the success screen. */
contingentPurchaseRouter.get(
  "/:contingentPurchaseGroupId/vertical-codes",
  authenticationMiddleware,
  asyncHandler(getPurchaseVerticalCodes)
);
contingentPurchaseRouter.get(
  "/mine",
  authenticationMiddleware,
  asyncHandler(getMyContingentPurchases)
);
contingentPurchaseRouter.post(
  "/:contingentPurchaseGroupId/cancel",
  authenticationMiddleware,
  asyncHandler(postCancelContingentPurchase)
);

module.exports = {
  inviteCodeRouter,
  festContingentRouter,
  publicContingentRouter,
  contingentClaimRouter,
  contingentPurchaseRouter,
};
