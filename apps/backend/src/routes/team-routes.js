const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  postCreateTeam,
  getMyTeams,
  postLockTeam,
  postClaimCaptain,
  deleteClaimCaptain,
} = require("../controllers/team-controller");

/*
 * Team formation is a user-owned action: authentication is the only gate. A team
 * is created for a team event (the caller becomes its leader and first member),
 * and the caller can list every team they belong to. Joining a team by invite
 * code lives under /registrations/mine/join-team, alongside the other seat-taking
 * actions.
 */
const teamRouter = express.Router();

teamRouter.post("/", authenticationMiddleware, asyncHandler(postCreateTeam));
teamRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyTeams));
teamRouter.post("/:teamId/lock", authenticationMiddleware, asyncHandler(postLockTeam));

/*
 * The captain is claimed by a member rather than assigned by the leader, so the
 * gate is membership, checked in the service against the team's own roster.
 */
teamRouter.post("/:teamId/claim-captain", authenticationMiddleware, asyncHandler(postClaimCaptain));
teamRouter.delete(
  "/:teamId/claim-captain",
  authenticationMiddleware,
  asyncHandler(deleteClaimCaptain)
);

module.exports = { teamRouter };
