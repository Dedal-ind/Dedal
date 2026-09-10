const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { getSearchParticipants } = require("../controllers/participant-search-controller");

/*
 * The name-search fallback for a scanner whose QR and backup-code paths both
 * fail. Authentication is the gate here; the service further restricts results
 * to staff of the named fest.
 */
const participantSearchRouter = express.Router();

participantSearchRouter.get("/search", authenticationMiddleware, asyncHandler(getSearchParticipants));

module.exports = { participantSearchRouter };
