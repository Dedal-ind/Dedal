const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  postCreateShift,
  getFestShifts,
  getShift,
  patchShift,
  postCancelShift,
  getFestVolunteers,
  getMyShifts,
} = require("../controllers/volunteer-shift-controller");

// mergeParams inherits :festId. Reads admit the fest's admin or any active coordinator
// (a coordinator may see who is on duty); shift writes are administrator-only.
const festScoped = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];
const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];

const festShiftRouter = express.Router({ mergeParams: true });
festShiftRouter.post("/", ...administratorOnly, asyncHandler(postCreateShift));
festShiftRouter.get("/", ...festScoped, asyncHandler(getFestShifts));
festShiftRouter.get("/:shiftId", ...festScoped, asyncHandler(getShift));
festShiftRouter.patch("/:shiftId", ...administratorOnly, asyncHandler(patchShift));
festShiftRouter.post("/:shiftId/cancel", ...administratorOnly, asyncHandler(postCancelShift));

const festVolunteerRouter = express.Router({ mergeParams: true });
festVolunteerRouter.get("/", ...festScoped, asyncHandler(getFestVolunteers));

// The volunteer's own shifts across every fest — authentication is the only gate.
const myShiftRouter = express.Router();
myShiftRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyShifts));

module.exports = { festShiftRouter, festVolunteerRouter, myShiftRouter };
