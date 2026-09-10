/*
 * The Google Maps search URL for a venue string.
 *
 * Deliberately duplicated from the frontend's helpers/venue-map-link.js rather
 * than shared: the two projects have no common module (one is ESM in Vite, the
 * other CommonJS in Node) and inventing a shared package for one template string
 * would cost more than it saves. The URL FORM is the contract — keep the two in
 * step if it ever changes.
 *
 * A search link, not the Maps API: no key, no billing, no quota. It opens the
 * native Maps app when installed and the website otherwise.
 */

const MAPS_SEARCH_BASE_URL = "https://www.google.com/maps/search/?api=1&query=";

function buildMapsUrl(venueText) {
  if (typeof venueText !== "string") {
    return null;
  }
  const normalisedVenue = venueText.replace(/\s+/g, " ").trim();
  if (normalisedVenue.length === 0) {
    return null;
  }
  return `${MAPS_SEARCH_BASE_URL}${encodeURIComponent(normalisedVenue)}`;
}

module.exports = { buildMapsUrl };
