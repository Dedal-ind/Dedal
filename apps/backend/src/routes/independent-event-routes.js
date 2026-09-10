const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { validateCreateEventPayload } = require("../validators/event-validator");
const independentEventService = require("../services/independent-event-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * The independent-event flow. Authentication only at the router — the service
 * itself requires an ACTIVE administrator assignment (it needs the admin's
 * college to host the wrapper fest), which is the real authority check here;
 * the fest-scoped admin middleware cannot run because no fest exists yet.
 */
const independentEventRouter = express.Router();

independentEventRouter.post(
  "/independent",
  authenticationMiddleware,
  asyncHandler(async (request, response) => {
    const validation = validateCreateEventPayload(request.body);
    if (!validation.ok) {
      return response.status(400).json({ error: validation.error });
    }
    const { userId } = request.authenticatedUser;
    const result = await independentEventService.createIndependentEvent(
      userId,
      validation.value,
      extractRequestContext(request)
    );
    return response.status(201).json({ data: result });
  })
);

/*
 * GET /api/v1/events/:eventId/calendar.ics — PUBLIC, deliberately.
 *
 * The link lives in a confirmation email, and a participant who taps it days
 * later is a browser with no token: gating it would hand them a 401 instead of
 * a calendar entry. What it exposes is what the public event page already
 * shows — name, time, venue — for a publicly visible event only. Drafts and
 * cancelled events 404 rather than leaking an unannounced schedule.
 *
 * Declared BEFORE nothing else matters here, but note the literal ".ics" suffix
 * keeps it from colliding with any /:eventId route added later.
 */
independentEventRouter.get(
  "/:eventId/calendar.ics",
  asyncHandler(async (request, response) => {
    const { icsFileContent, icsFileName } = await independentEventService.buildEventCalendarFile(
      request.params.eventId
    );
    response.setHeader("Content-Type", "text/calendar; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${icsFileName}"`);
    // A schedule can move; a stale cached file is a missed event.
    response.setHeader("Cache-Control", "public, max-age=300");
    return response.send(icsFileContent);
  })
);

module.exports = { independentEventRouter };
