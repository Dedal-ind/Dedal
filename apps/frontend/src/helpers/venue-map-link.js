// venue-map-link.js
// Turns the venue string into a Google Maps search URL.
//
// A SEARCH link, deliberately — not the Maps JavaScript API, not Places, not an
// embed. Those need an API key, a billing account and a per-load cost, and all
// any of this needs to do is answer "where is that?". The universal
// `?api=1&query=` form is the documented deep link: it opens the native Maps app
// on Android and iOS when installed and the website otherwise, with no key.
//
// Venues are typed by organisers ("Robotics Lab", "Main Auditorium, Block C"),
// so the query is a free-text search rather than a coordinate. Maps resolves it
// against the surrounding map context, which is the best available answer when
// nobody has recorded a latitude.

const MAPS_SEARCH_BASE_URL = 'https://www.google.com/maps/search/?api=1&query=';

export function buildMapsUrl(venueText) {
  if (typeof venueText !== 'string') {
    return null;
  }
  const normalisedVenue = venueText.replace(/\s+/g, ' ').trim();
  if (normalisedVenue.length === 0) {
    // No venue text means no link — the caller renders plain text instead of an
    // anchor pointing at an empty Maps search.
    return null;
  }
  return `${MAPS_SEARCH_BASE_URL}${encodeURIComponent(normalisedVenue)}`;
}
