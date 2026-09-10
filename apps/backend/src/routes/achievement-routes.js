const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getMyAchievements,
  getUserAchievements,
  postSelfDeclaredAchievement,
  patchSelfDeclaredAchievement,
  deleteSelfDeclaredAchievement,
} = require("../controllers/achievement-controller");

/*
 * Achievements hang off /api/v1/users. Every route is authenticated: a profile is
 * only visible to signed-in users. The literal "me" routes are declared before
 * "/:userId/achievements" so an owner viewing their own profile through /me never
 * falls into the public-view handler that hides their hidden self-declared rows.
 */
const userAchievementRouter = express.Router();

userAchievementRouter.get("/me/achievements", authenticationMiddleware, asyncHandler(getMyAchievements));
userAchievementRouter.post(
  "/me/achievements",
  authenticationMiddleware,
  asyncHandler(postSelfDeclaredAchievement)
);
userAchievementRouter.patch(
  "/me/achievements/:achievementId",
  authenticationMiddleware,
  asyncHandler(patchSelfDeclaredAchievement)
);
userAchievementRouter.delete(
  "/me/achievements/:achievementId",
  authenticationMiddleware,
  asyncHandler(deleteSelfDeclaredAchievement)
);

userAchievementRouter.get(
  "/:userId/achievements",
  authenticationMiddleware,
  asyncHandler(getUserAchievements)
);

module.exports = { userAchievementRouter };
