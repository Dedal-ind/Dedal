const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  postAssignStaffToEvents,
  getFestStaffRoster,
} = require("../controllers/fest-staff-controller");

/*
 * Event-first staff management, mounted at /fests/:festId/staff. Both the
 * single-call assign and the person-centric roster (with full history) are
 * administrator-only — coordinators do not manage or view the whole roster.
 */
const festStaffRouter = express.Router({ mergeParams: true });

const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];

festStaffRouter.post("/assign", ...administratorOnly, asyncHandler(postAssignStaffToEvents));
festStaffRouter.get("/", ...administratorOnly, asyncHandler(getFestStaffRoster));

module.exports = { festStaffRouter };
