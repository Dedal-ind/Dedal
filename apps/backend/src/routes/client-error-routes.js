const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  clientErrorRateLimiterMiddleware,
} = require("../middleware/public-rate-limiter-middleware");
const { recordClientError } = require("../services/client-error-log-service");
const { readOptionalAuthenticatedUserId } = require("../helpers/optional-authentication");

/*
 * POST /api/v1/errors/client — UNAUTHENTICATED, deliberately.
 *
 * The reports worth having most are the ones from a session that broke before
 * anyone could sign in: a crash on the sign-in screen itself, or a bundle that
 * fails to boot. Requiring a token would filter out exactly those.
 *
 * The trade is that anyone can write here, which is why the row is capped by the
 * model, the endpoint is limited to 10 reports per IP per minute, and the
 * collection expires itself after 30 days.
 *
 * It always answers 202. The client is already broken; there is nothing useful
 * it could do with a failure, and a non-2xx would invite the boundary to retry.
 */
const clientErrorRouter = express.Router();

clientErrorRouter.post(
  "/client",
  clientErrorRateLimiterMiddleware,
  asyncHandler(async (request, response) => {
    // Attributed when a token happens to be present, never required.
    const userId = readOptionalAuthenticatedUserId(request);
    await recordClientError(request.body ?? {}, userId);
    return response.status(202).json({ data: { received: true } });
  })
);

module.exports = { clientErrorRouter };
