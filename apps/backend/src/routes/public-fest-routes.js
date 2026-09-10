const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  getPublicFests,
  getPublicFestById,
  getPublicFestBySlug,
  getPublicFestEvents,
  getPublicEventBySlug,
  getPublicFestContingents,
} = require("../controllers/public-fest-controller");

/*
 * The participant-facing browse namespace: no authentication, no admin-visibility
 * branching. Every route reads only published fests and their public events, so
 * the admin endpoints under /api/v1/fests keep their own concerns.
 */
const publicFestRouter = express.Router();

publicFestRouter.get("/", asyncHandler(getPublicFests));

/*
 * The id detail route is constrained to a 24-hex ObjectId so a non-id single
 * segment falls through to the slug route below — the two share the same path
 * shape, and this is the only disambiguation between them. Real ids route here
 * exactly as before.
 */
publicFestRouter.get("/:festId([0-9a-fA-F]{24})", asyncHandler(getPublicFestById));
publicFestRouter.get("/:festId([0-9a-fA-F]{24})/events", asyncHandler(getPublicFestEvents));
/*
 * Every published bundle in the fest, batched. Declared alongside /events and
 * under the same 24-hex constraint, so it is matched as an id route and never
 * swallowed by the /:festSlug pattern below.
 */
publicFestRouter.get(
  "/:festId([0-9a-fA-F]{24})/contingents",
  asyncHandler(getPublicFestContingents)
);

// The shareable, slug-based public surface for QR links.
publicFestRouter.get("/:festSlug", asyncHandler(getPublicFestBySlug));
publicFestRouter.get("/:festSlug/events/:eventSlug", asyncHandler(getPublicEventBySlug));

module.exports = { publicFestRouter };
