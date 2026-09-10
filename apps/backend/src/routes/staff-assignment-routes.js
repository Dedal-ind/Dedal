const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  postAssignStaffMember,
  getStaffAssignmentsForFest,
  postRevokeStaffAssignment,
  getMyStaffAssignments,
} = require("../controllers/staff-assignment-controller");

/*
 * mergeParams inherits :festId from the mount point. Without it, every handler
 * and require-administrator-middleware would see an empty params object and the
 * fest lookup would fail.
 */
const festStaffAssignmentRouter = express.Router({ mergeParams: true });

const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];

festStaffAssignmentRouter.post("/", ...administratorOnly, asyncHandler(postAssignStaffMember));
festStaffAssignmentRouter.get("/", ...administratorOnly, asyncHandler(getStaffAssignmentsForFest));
festStaffAssignmentRouter.post(
  "/:assignmentId/revoke",
  ...administratorOnly,
  asyncHandler(postRevokeStaffAssignment)
);

/*
 * Mounted at the top level, not under a fest: a staff member reads their own
 * assignments across every fest, and administers none of them. Authentication is
 * the only gate, and the service filters by the caller's own id.
 */
const myStaffAssignmentRouter = express.Router();

myStaffAssignmentRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyStaffAssignments));

module.exports = { festStaffAssignmentRouter, myStaffAssignmentRouter };
