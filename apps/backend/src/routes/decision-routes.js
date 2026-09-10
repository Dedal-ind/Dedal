const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { getDecision } = require("../controllers/decision-controller");

/*
 * The decision engine's one read. Authenticated: a decision is for a
 * participant, and the age gate needs to know who is asking. The old public
 * promotion endpoint is untouched and keeps serving the carousel.
 */
const decisionRouter = express.Router();

decisionRouter.get("/", authenticationMiddleware, asyncHandler(getDecision));

module.exports = { decisionRouter };
