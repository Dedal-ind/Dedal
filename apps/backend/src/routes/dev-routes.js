const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { getSwitchableUsers, postLoginAs } = require("../controllers/dev-controller");

/*
 * Development-only conveniences. No authentication middleware — the whole point of
 * login-as is to establish a session — but every handler is hard-gated to
 * APPLICATION_ENVIRONMENT=development inside dev-service, so outside development
 * these paths answer 404 as though they were never mounted.
 */
const devRouter = express.Router();

devRouter.get("/users", asyncHandler(getSwitchableUsers));
devRouter.post("/login-as", asyncHandler(postLoginAs));

module.exports = { devRouter };
