const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  postEventFeedback,
  getEventFeedbackEligibility,
  getEventFeedbackSummary,
} = require("../controllers/event-feedback-controller");

/*
 * Post-event feedback, mounted at /api/v1/events/:eventId/feedback.
 *
 * mergeParams because :eventId belongs to the mount path, not to any route
 * declared here.
 *
 * Every route is authenticated: there is no anonymous rating. The staff read is
 * gated inside the controller rather than by middleware, because the
 * coordinator/admin middleware needs a :festId this path does not carry — see
 * assertCanReadEventFeedback.
 */
const eventFeedbackRouter = express.Router({ mergeParams: true });

// The summary is declared first so "summary" is never read as a sub-resource.
eventFeedbackRouter.get("/summary", authenticationMiddleware, asyncHandler(getEventFeedbackSummary));

/*
 * What the participant app asks before deciding whether to show the rating
 * card: did I attend, and have I already rated.
 */
eventFeedbackRouter.get("/me", authenticationMiddleware, asyncHandler(getEventFeedbackEligibility));

eventFeedbackRouter.post("/", authenticationMiddleware, asyncHandler(postEventFeedback));

module.exports = { eventFeedbackRouter };
