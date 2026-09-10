const FEST_VISIBILITIES = {
  INTRA_COLLEGE: "intraCollege",
  INTER_COLLEGE: "interCollege",
  PUBLIC: "public",
};

const FEST_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  /*
   * The fest is called off. Distinct from ARCHIVED, which only hides a fest that
   * still happened (or still will). CANCELLED is IRREVERSIBLE: participants have
   * been emailed, entitlements revoked and refunds marked, none of which can be
   * un-done — transitionFest therefore has no edge out of it, and a change of
   * plans means a new fest.
   */
  CANCELLED: "cancelled",
};

const FEST_SLUG_MAXIMUM_ATTEMPTS = 20;

/*
 * The statuses a participant may browse. A fest has no "ongoing"/"completed"
 * status of its own — those are date-derived views of a published fest — so
 * published is the one publicly visible state. Draft and archived stay hidden.
 */
const PUBLICLY_VISIBLE_FEST_STATUSES = [FEST_STATUSES.PUBLISHED];

/*
 * Offer keys the registration flow already depends on for behaviour: "food"
 * drives the food-preference question and meal count, "accommodation" the stay
 * question. Every other offer key is free-form and (until phase 2's per-offer
 * answers/entitlements) carries no registration behaviour of its own.
 */
const RESERVED_OFFER_KEYS = {
  FOOD: "food",
  ACCOMMODATION: "accommodation",
};

/*
 * The sponsor billing ranks, declared HIGHEST FIRST. The order of the keys is
 * the priority order: Object.values() preserves it, so SPONSOR_TIERS_IN_PRIORITY_ORDER
 * is derived from this object rather than restated (two lists would drift).
 *
 * The frontend sorts a sponsor strip by this order; the backend stores whatever
 * order it is given and does not re-sort. Ordering is a display decision.
 */
const SPONSOR_TIERS = {
  TITLE: "title",
  PRESENTING: "presenting",
  ASSOCIATE: "associate",
  PARTNER: "partner",
};

const SPONSOR_TIERS_IN_PRIORITY_ORDER = Object.values(SPONSOR_TIERS);

// Embedded arrays must stay bounded; enforced by the fest model's validate hook.
const FEST_OFFERS_MAX = 12;
/*
 * The same rule for the sponsor logo strip. This was 20; a strip that long is an
 * unreadable horizontal scroll on a phone, so it is now 10. A fest that already
 * holds more than 10 sponsors will FAIL its next save until an administrator
 * trims the list — deliberate, because the cap is a display constraint and a
 * silently truncating migration would drop a paying sponsor without telling
 * anyone.
 */
const FEST_SPONSORS_MAX = 10;
/*
 * An event's own strip is shorter still: it renders inside the event page under
 * the fest-wide strip, so the two together must stay glanceable.
 */
const EVENT_SPONSORS_MAX = 5;
const SPONSOR_NAME_MAX_LENGTH = 80;

/* An offer can hang off the whole fest or off one event; the participant sees
 * both and the registration row records which, so a scan knows what it claims. */
const OFFER_SCOPES = {
  FEST: "fest",
  EVENT: "event",
};

module.exports = {
  FEST_VISIBILITIES,
  FEST_STATUSES,
  FEST_SLUG_MAXIMUM_ATTEMPTS,
  PUBLICLY_VISIBLE_FEST_STATUSES,
  RESERVED_OFFER_KEYS,
  FEST_OFFERS_MAX,
  FEST_SPONSORS_MAX,
  EVENT_SPONSORS_MAX,
  SPONSOR_TIERS,
  SPONSOR_TIERS_IN_PRIORITY_ORDER,
  SPONSOR_NAME_MAX_LENGTH,
  OFFER_SCOPES,
};
