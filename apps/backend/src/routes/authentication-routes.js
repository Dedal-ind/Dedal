const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { alreadySignedInMiddleware } = require("../middleware/already-signed-in-middleware");
const {
  handleRequestOtp,
  handleVerifyOtp,
  handleGoogleSignIn,
  handleGoogleConfig,
} = require("../controllers/authentication-controller");

const authenticationRouter = express.Router();

// PUBLIC and unauthenticated by definition — the sign-in screen calls it before
// any session exists. It serves only the public client id (see the controller).
authenticationRouter.get("/google/config", asyncHandler(handleGoogleConfig));

authenticationRouter.post("/request-otp", alreadySignedInMiddleware, asyncHandler(handleRequestOtp));
authenticationRouter.post("/verify-otp", alreadySignedInMiddleware, asyncHandler(handleVerifyOtp));
authenticationRouter.post("/google", alreadySignedInMiddleware, asyncHandler(handleGoogleSignIn));

module.exports = { authenticationRouter };
