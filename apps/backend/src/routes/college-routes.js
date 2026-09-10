const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { requirePlatformAdminMiddleware } = require("../middleware/require-platform-admin-middleware");
const {
  getListMyAdminColleges,
  getListVerifiedColleges,
  postRegisterCollege,
  getListAllColleges,
  postSetCollegeVerification,
} = require("../controllers/college-controller");

const collegeRouter = express.Router();

// Public: the verified colleges a participant picks during profile completion.
collegeRouter.get("/", asyncHandler(getListVerifiedColleges));

// The colleges the signed-in user administers.
collegeRouter.get("/mine-admin", authenticationMiddleware, asyncHandler(getListMyAdminColleges));

// Self-signup: register a college (pending) and become its administrator.
collegeRouter.post("/register", authenticationMiddleware, asyncHandler(postRegisterCollege));

// Platform-owner onboarding queue + approval.
collegeRouter.get(
  "/all",
  authenticationMiddleware,
  requirePlatformAdminMiddleware,
  asyncHandler(getListAllColleges)
);
collegeRouter.post(
  "/:collegeId/verification",
  authenticationMiddleware,
  requirePlatformAdminMiddleware,
  asyncHandler(postSetCollegeVerification)
);

module.exports = { collegeRouter };
