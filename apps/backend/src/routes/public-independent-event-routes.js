const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  getPublicIndependentEvents,
  getPublicEventByBareSlug,
} = require("../controllers/public-fest-controller");

/*
 * GET /api/v1/public/events/independent — published independent events (those
 * wrapped in hidden solo-container fests). Unauthenticated, published data
 * only, same contract as the rest of the /public namespace. Mounted on its own
 * literal path in application.js so it can never be captured as an :eventId by
 * the parameterised /public/events/:eventId/* mounts.
 */
const publicIndependentEventRouter = express.Router();

publicIndependentEventRouter.get("/", asyncHandler(getPublicIndependentEvents));

/*
 * GET /api/v1/public/events/:eventSlug — the FLAT event-by-slug lookup, the
 * deep-link resolver for independent events (whose wrapper fests are hidden
 * from the catalog). Mounted in application.js AFTER the /independent mount, so
 * the literal wins; and its single-segment param never captures the
 * /public/events/:eventId/contingents or /staff-contacts sub-paths.
 */
const publicEventBySlugRouter = express.Router();

publicEventBySlugRouter.get("/:eventSlug", asyncHandler(getPublicEventByBareSlug));

module.exports = { publicIndependentEventRouter, publicEventBySlugRouter };
