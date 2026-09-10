const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getMyPassForFest,
  getMyAllPasses,
  postResendMyPassEmail,
} = require("../controllers/pass-controller");
const { getMyPassGateStatus } = require("../controllers/campus-access-controller");

/*
 * A pass is a user-owned artefact: authentication is the only gate, and the
 * service filters by the caller's own id. "/mine/all" is declared before
 * "/mine" is not needed here since the paths do not overlap.
 */
const passRouter = express.Router();

passRouter.get("/mine/all", authenticationMiddleware, asyncHandler(getMyAllPasses));
passRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyPassForFest));

// Owner-only: the service refuses a passId the caller does not hold.
passRouter.post(
  "/:passId/resend-email",
  authenticationMiddleware,
  asyncHandler(postResendMyPassEmail)
);

/*
 * The pass's own campus-access history: whether its holder has crossed the Main
 * Gate today, and on which earlier days they did. Owner-only by the same rule as
 * resend-email — the service compares the pass's userId to the caller's, because
 * a route that only required authentication would let any signed-in user learn
 * when any other participant was on campus.
 */
passRouter.get(
  "/mine/:passId/gate-status",
  authenticationMiddleware,
  asyncHandler(getMyPassGateStatus)
);

module.exports = { passRouter };
