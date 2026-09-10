const festService = require("../services/fest-service");
const eventService = require("../services/event-service");
const contingentService = require("../services/contingent-service");

async function getPublicFests(request, response) {
  // Optional browse shapers: ?category=<eventCategory> keeps fests containing an
  // event of that category; ?sort=name|date orders the list (default date).
  const fests = await festService.listPublicFests({
    category: typeof request.query.category === "string" ? request.query.category : undefined,
    sort: typeof request.query.sort === "string" ? request.query.sort : undefined,
  });
  return response.status(200).json({ data: fests });
}

/*
 * Published independent events (the ones wrapped in hidden solo-container
 * fests) — GET /public/events/independent. Without this they were invisible to
 * participants, because the public fest list hides their wrapper fests.
 */
async function getPublicIndependentEvents(request, response) {
  const events = await eventService.listPublicIndependentEvents();
  return response.status(200).json({ data: events });
}

/*
 * Flat event-by-slug lookup — the deep-link resolver for independent events
 * (and a rescue path for any published event). GET /public/events/:eventSlug.
 */
async function getPublicEventByBareSlug(request, response) {
  const event = await eventService.getPublicEventByBareSlug(request.params.eventSlug);
  return response.status(200).json({ data: event });
}

async function getPublicFestById(request, response) {
  const fest = await festService.getPublicFestById(request.params.festId);
  return response.status(200).json({ data: fest });
}

async function getPublicFestBySlug(request, response) {
  const fest = await festService.getPublicFestBySlug(request.params.festSlug);
  return response.status(200).json({ data: fest });
}

/*
 * The fest's public visibility is proven first (by slug), then the event is looked
 * up within it. The loaded fest carries the slug needed to build the event's
 * shareableUrl, so the event service does not have to re-read it.
 */
async function getPublicEventBySlug(request, response) {
  const fest = await festService.getPublicFestBySlug(request.params.festSlug);
  const event = await eventService.getPublicEventBySlug(
    fest.id,
    request.params.eventSlug,
    fest.festSlug
  );
  return response.status(200).json({ data: event });
}

/*
 * The fest's public visibility is proven first, so a draft or archived fest's
 * events are never reachable through the public namespace even though the event
 * list service itself does not check fest status.
 */
async function getPublicFestEvents(request, response) {
  await festService.getPublicFestById(request.params.festId);
  // includeChildren=true returns the whole event tree (every depth) in one flat
  // array so the client can build the vertical/leaf hierarchy itself; the default
  // stays top-level-only for any caller that does not ask.
  const includeChildren = request.query.includeChildren === "true";
  const events = await eventService.listPublicEvents(request.params.festId, { includeChildren });
  return response.status(200).json({ data: events });
}

/*
 * Every published bundle in the fest, in one request, grouped by container.
 *
 * The fest's public visibility is proven FIRST, exactly as getPublicFestEvents
 * does it — so a draft or archived fest never leaks its pricing through this
 * route, and a malformed or unknown festId comes back as the same 404 the rest
 * of the public namespace returns rather than a cast error.
 */
async function getPublicFestContingents(request, response) {
  const fest = await festService.getPublicFestById(request.params.festId);
  const grouped = await contingentService.listPublicContingentsForFest(fest.id);
  return response.status(200).json({ data: grouped });
}

module.exports = {
  getPublicFests,
  getPublicFestById,
  getPublicFestBySlug,
  getPublicFestEvents,
  getPublicFestContingents,
  getPublicEventBySlug,
  getPublicIndependentEvents,
  getPublicEventByBareSlug,
};
