// public-catalog.js
// The backend has no flat "all events" endpoint — events live under each fest
// (GET /public/fests/:festId/events). This helper fetches every published public
// fest and its events, then flattens the registerable (leaf) events into one
// list, annotating each with its fest's slug/name/college so browse and search
// screens can label and route without a second lookup.

import apiClient from '../api-client/api-client.js';

// A registerable event is a leaf: it carries a category. Container/grouping
// events have category === null and are not shown as browseable event cards.
function isRegisterableEvent(event) {
  return event.category !== null && event.category !== undefined;
}

function readCollegeName(fest) {
  if (fest.hostCollegeId && typeof fest.hostCollegeId === 'object') {
    return fest.hostCollegeId.commonName ?? fest.hostCollegeId.collegeName ?? '';
  }
  return '';
}

// Loads a single registerable event by its id together with its parent fest
// (needed for the offersFood / offersAccommodation flags). Returns null if the
// event is not found among published fests.
export async function fetchEventWithFest(eventId) {
  const { fests, events } = await fetchPublicCatalog();
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) {
    return null;
  }
  /*
   * An independent event's wrapper fest is deliberately absent from `fests` —
   * solo containers are hidden from browsing. A null fest here is therefore the
   * correct answer rather than a lookup failure: there is no fest page to link
   * to and no fest-wide offers to apply, and every consumer already reads it
   * with optional chaining.
   */
  const fest = event.isIndependent
    ? null
    : (fests.find((candidate) => candidate.festSlug === event.festSlug) ?? null);
  return { event, fest };
}

// Loads every published fest with its full event tree (containers AND leaves),
// each event annotated with its fest's slug/name/college. The shared core behind
// both public catalog readers below.
async function loadAnnotatedCatalog() {
  /*
   * Independent events are fetched alongside the fests. They live inside hidden
   * solo-container fests, which /public/fests deliberately does not return —
   * without this second call an admin could create a standalone workshop and no
   * participant would ever see it anywhere in the app.
   *
   * The listing already carries festSlug from its wrapper, so the events slot
   * into the same flat array as everything else.
   */
  const [fests, independentEvents] = await Promise.all([
    apiClient.get('/public/fests'),
    apiClient.get('/public/events/independent').catch(() => []),
  ]);
  const festList = Array.isArray(fests) ? fests : [];

  // includeChildren so nested leaf events are returned alongside their top-level
  // container (vertical) events, letting the callers build the hierarchy.
  const eventListsByFest = await Promise.all(
    festList.map((fest) =>
      apiClient.get(`/public/fests/${fest.id}/events?includeChildren=true`).catch(() => []),
    ),
  );

  const events = [];
  festList.forEach((fest, festIndex) => {
    const festEvents = eventListsByFest[festIndex] ?? [];
    festEvents.forEach((event) => {
      events.push({
        ...event,
        festSlug: fest.festSlug,
        festName: fest.festName,
        collegeName: readCollegeName(fest),
      });
    });
  });

  /* Standalone events have no browsable fest, so they carry their own host
   * college name rather than one read off a fest card. */
  (Array.isArray(independentEvents) ? independentEvents : []).forEach((event) => {
    events.push({
      ...event,
      festName: null,
      collegeName: event.hostCollegeName ?? '',
      isIndependent: true,
    });
  });

  return { fests: festList, events };
}

// Leaf-only view: just the registerable events (a category, no children). The
// default for browse/search/registration screens that deal in bookable events.
export async function fetchPublicCatalog() {
  const { fests, events } = await loadAnnotatedCatalog();
  return { fests, events: events.filter(isRegisterableEvent) };
}

// Full-tree view: container (vertical) events AND their leaf descendants, so a
// caller can render the top-level verticals and reason about what they contain
// (e.g. filtering a vertical in when any of its descendants matches a category).
export async function fetchPublicCatalogTree() {
  return loadAnnotatedCatalog();
}
