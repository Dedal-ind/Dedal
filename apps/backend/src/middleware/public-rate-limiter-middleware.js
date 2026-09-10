const rateLimit = require("express-rate-limit");

const { ERROR_CODES } = require("../constants/error-codes");

/*
 * Rate limiting for the unauthenticated surface.
 *
 * WHY A DEPENDENCY, against the project's usual no-new-deps rule. A hand-rolled
 * limiter is a security control, and the failure modes are not obvious: reading
 * X-Forwarded-For without a configured trust-proxy depth lets any client spoof
 * its own IP and bypass the limit entirely, and an in-process Map with no
 * eviction is itself a memory-exhaustion vector. express-rate-limit is the
 * Express team's own recommendation, has no transitive dependencies, and gets
 * the IP resolution right.
 *
 * WHY ONLY PUBLIC ROUTES. Authenticated traffic is already bounded per user —
 * the OTP send/attempt limiters guard sign-in, and every other authenticated
 * route needs a token that a bot has to earn first. The exposure is the browse
 * surface a signed-out visitor reaches, which is also the one that runs the
 * heaviest unindexed reads.
 */

const PUBLIC_WINDOW_MILLISECONDS = 15 * 60 * 1000;

const PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW = 100;

/*
 * Client error reports get their own, much tighter budget. A crash loop on one
 * device can emit hundreds of identical reports a second, and the whole point
 * of the collection is to be readable afterwards.
 */
const CLIENT_ERROR_WINDOW_MILLISECONDS = 60 * 1000;
const CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW = 10;

/*
 * The refusal body matches the platform's error envelope, so a client that
 * already switches on error.code does not need a special case for 429.
 * Retry-After is set by the library from the window.
 */
function buildRateLimitHandler(message) {
  return (request, response) => {
    return response.status(429).json({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message,
        details: {},
      },
    });
  };
}

const publicRateLimiterMiddleware = rateLimit({
  windowMs: PUBLIC_WINDOW_MILLISECONDS,
  limit: PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW,
  // Draft-8 headers carry Retry-After alongside RateLimit-*; the legacy
  // X-RateLimit-* set is off because nothing here reads it.
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: buildRateLimitHandler(
    "Too many requests. Wait a few minutes and try again."
  ),
});

const clientErrorRateLimiterMiddleware = rateLimit({
  windowMs: CLIENT_ERROR_WINDOW_MILLISECONDS,
  limit: CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: buildRateLimitHandler("Too many error reports. Slow down."),
});

module.exports = {
  publicRateLimiterMiddleware,
  clientErrorRateLimiterMiddleware,
  PUBLIC_WINDOW_MILLISECONDS,
  PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW,
  CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW,
};
