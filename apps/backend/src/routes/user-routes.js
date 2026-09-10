const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getMyProfile,
  patchMyProfile,
  getMyConsents,
  postWithdrawMyConsent,
  deleteMyAccount,
  postSaveEvent,
  deleteSaveEvent,
  getSavedEvents,
} = require("../controllers/user-controller");

/* Profile reads and edits are user-owned: authentication is the only gate. */
const userRouter = express.Router();

userRouter.get("/me", authenticationMiddleware, asyncHandler(getMyProfile));
userRouter.patch("/me", authenticationMiddleware, asyncHandler(patchMyProfile));
/* Consent standing and withdrawal. User-owned like the profile: the id comes
   from the token, so nobody can read or withdraw on another's behalf. */
userRouter.get("/me/consents", authenticationMiddleware, asyncHandler(getMyConsents));
userRouter.post(
  "/me/consents/withdraw",
  authenticationMiddleware,
  asyncHandler(postWithdrawMyConsent)
);
/*
 * Saved events. Scoped under /me so a user can only ever touch their own list —
 * the id comes from the token, never the URL.
 *
 * These are declared BEFORE DELETE /me so that "/me/saved-events/:eventId" is
 * matched by its own handler rather than being swallowed by the account-deletion
 * route on a path-prefix match.
 */
userRouter.get("/me/saved-events", authenticationMiddleware, asyncHandler(getSavedEvents));
userRouter.post(
  "/me/saved-events/:eventId",
  authenticationMiddleware,
  asyncHandler(postSaveEvent)
);
userRouter.delete(
  "/me/saved-events/:eventId",
  authenticationMiddleware,
  asyncHandler(deleteSaveEvent)
);

userRouter.delete("/me", authenticationMiddleware, asyncHandler(deleteMyAccount));

module.exports = { userRouter };
