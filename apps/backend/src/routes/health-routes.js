const express = require("express");
const { asyncHandler } = require("../middleware/async-handler");

const healthRouter = express.Router();

healthRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    response.status(200).json({
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
    });
  })
);

/*
 * The deployed environment, for clients that must feature-detect rather than
 * guess from the hostname (a staging build served on an unexpected domain must
 * still behave as staging). Public and deliberately minimal: a name, nothing else.
 */
healthRouter.get(
  "/environment",
  asyncHandler(async (request, response) => {
    const { applicationConfig } = require("../config/application-config");
    response.status(200).json({
      data: { environment: applicationConfig.applicationEnvironment },
    });
  })
);

module.exports = { healthRouter };
