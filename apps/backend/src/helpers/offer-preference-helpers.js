const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FOOD_PREFERENCES } = require("../constants/registration-constants");
const { EVENT_TYPES } = require("../constants/event-constants");
const { RESERVED_OFFER_KEYS, OFFER_SCOPES } = require("../constants/fest-constants");

const ALLOWED_FOOD_PREFERENCES = Object.values(FOOD_PREFERENCES);

/*
 * Offers replaced the fest's offersFood/offersAccommodation booleans: "does this
 * fest offer X" is now "does an ACTIVE offer with the reserved key exist". The
 * resolver signatures and error codes are unchanged — behaviour is identical,
 * only the source of truth moved.
 */
/*
 * Every active offer visible to a registration, from BOTH scopes, each tagged
 * with where it came from. A fest-wide "Food" and an event-only "Food" are two
 * distinct offers at two distinct rates: they are NOT deduplicated by key, only
 * by (scope, offerKey), and the participant picks between them by name+badge.
 */
function listActiveOffers(fest, event = null) {
  const festOffers = (fest?.offers ?? [])
    .filter((offer) => offer.isActive !== false)
    .map((offer) => ({ offer, scope: OFFER_SCOPES.FEST }));
  const eventOffers = (event?.offers ?? [])
    .filter((offer) => offer.isActive !== false)
    .map((offer) => ({ offer, scope: OFFER_SCOPES.EVENT }));
  return [...festOffers, ...eventOffers];
}

/*
 * The reserved-key lookup that drives the dietary/stay sub-questions. An
 * event-scoped "Food" counts: the question is about whether food is on offer at
 * all, not about which level is paying for it. The fest-level offer wins when
 * both exist, so the answer keeps its historical meaning.
 */
function findActiveOffer(fest, offerKey, event = null) {
  return (
    listActiveOffers(fest, event).find((entry) => entry.offer.offerKey === offerKey)?.offer ?? null
  );
}

/*
 * The food preference for this registration, or null when the fest offers no
 * food. A value submitted to a non-offering fest is ignored rather than rejected,
 * exactly as the medical declaration ignores a truthy flag an event never asked
 * for — the record simply stays null. When the fest does offer food, the answer
 * is required and must be one of the three allowed values.
 */
function resolveFoodPreference(fest, foodPreference, event = null) {
  if (!findActiveOffer(fest, RESERVED_OFFER_KEYS.FOOD, event)) {
    return null;
  }
  if (!ALLOWED_FOOD_PREFERENCES.includes(foodPreference)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.FOOD_PREFERENCE_REQUIRED,
      "This fest offers food, so a food preference is required.",
      { allowedValues: ALLOWED_FOOD_PREFERENCES }
    );
  }
  return foodPreference;
}

/*
 * The accommodation need for this registration, or null when the fest offers no
 * accommodation. When it does, the answer is required and must be a boolean.
 */
function resolveAccommodationNeed(fest, needsAccommodation, event = null) {
  if (!findActiveOffer(fest, RESERVED_OFFER_KEYS.ACCOMMODATION, event)) {
    return null;
  }
  if (typeof needsAccommodation !== "boolean") {
    throw new ApplicationError(
      400,
      ERROR_CODES.ACCOMMODATION_PREFERENCE_REQUIRED,
      "This fest offers accommodation, so an accommodation answer is required."
    );
  }
  return needsAccommodation;
}

/*
 * How many meals the registering participant books, or null when the fest offers
 * no food. Runs AFTER resolveFoodPreference, whose result it takes:
 *
 * - noMealNeeded → 0, ignoring whatever was submitted, exactly as a preference
 *   submitted to a non-offering fest is ignored rather than rejected.
 * - Solo events → 1, derived, never asked: a solo registrant books one meal for
 *   themselves.
 * - Team events → an integer from 1 to the event's maximumTeamSize. Capped on
 *   maximumTeamSize, NOT the current roster size: with code-join the leader
 *   creates the team while they are still its only member, and a roster-based cap
 *   would let them book exactly one meal for a team of four.
 *
 * All food logic stays in this one file on purpose — fest.offersFood is about to
 * become an admin-defined offers list, and this is the single place that will
 * need to generalise. (Pricing meals and issuing MEAL entitlements are also
 * deliberately absent: food is not charged anywhere today, and scan-decision.js
 * cannot redeem a meal entitlement yet — both belong with the admin-defined
 * offers work.)
 */
function resolveFoodOrderCount(fest, event, foodPreference, rawValue) {
  if (!findActiveOffer(fest, RESERVED_OFFER_KEYS.FOOD, event)) {
    return null;
  }
  if (foodPreference === FOOD_PREFERENCES.NO_MEAL_NEEDED) {
    return 0;
  }
  if (event.eventType !== EVENT_TYPES.TEAM) {
    return 1;
  }
  const minimum = 1;
  const maximum = event.maximumTeamSize;
  if (!Number.isInteger(rawValue) || rawValue < minimum || rawValue > maximum) {
    throw new ApplicationError(
      400,
      ERROR_CODES.FOOD_ORDER_COUNT_INVALID,
      `The number of meals must be a whole number from ${minimum} to ${maximum}.`,
      { minimum, maximum }
    );
  }
  return rawValue;
}

/*
 * The participant's answers for NON-RESERVED offers, across BOTH scopes. The
 * two reserved keys are ignored here — food and accommodation have their
 * dedicated resolvers above — as is anything naming an inactive or unknown
 * offer (a stale client is harmlessly over-reporting, exactly as
 * resolveFoodPreference ignores a value a non-offering fest never asked for).
 *
 * Each selection carries the two generic axes. An axis the offer does not
 * collect is stored as 1 regardless of what was sent, so the stored row always
 * multiplies out correctly through the one price formula.
 */
// The fallback ceiling for an axis with no explicit maximum on a solo event
// (a people-axis on a team event caps on maximumTeamSize regardless).
const OFFER_QUANTITY_SANITY_MAXIMUM = 99;

function resolveAxisValue(offer, isCollected, rawValue, minimumBound, maximumBound, axisLabel, ceiling) {
  if (!isCollected) {
    return 1;
  }
  const minimum = Math.max(1, minimumBound ?? 1);
  const maximum = Math.min(maximumBound ?? ceiling, ceiling);
  if (!Number.isInteger(rawValue) || rawValue < minimum || rawValue > maximum) {
    throw new ApplicationError(
      400,
      ERROR_CODES.OFFER_SELECTION_INVALID,
      `The ${axisLabel} for "${offer.offerName}" must be a whole number from ${minimum} to ${maximum}.`,
      { offerKey: offer.offerKey, axis: axisLabel, minimum, maximum }
    );
  }
  return rawValue;
}

function resolveOfferSelections(fest, rawSelections, event = null) {
  if (!Array.isArray(rawSelections) || rawSelections.length === 0) {
    return [];
  }
  const reservedKeys = Object.values(RESERVED_OFFER_KEYS);
  const offersByScopedKey = new Map(
    listActiveOffers(fest, event).map((entry) => [`${entry.scope}:${entry.offer.offerKey}`, entry])
  );
  // The same team cap food uses: a team of 4 cannot book 5 DJ passes. Days are
  // NOT capped by team size — a stay length has nothing to do with roster size.
  const peopleCeiling =
    event?.eventType === "team" ? event.maximumTeamSize : OFFER_QUANTITY_SANITY_MAXIMUM;

  const resolvedSelections = [];
  const seenScopedKeys = new Set();
  for (const selection of rawSelections) {
    // A selection with no scope is read as fest-scoped: that is what every
    // client sent before event offers existed, and it keeps old payloads valid.
    const scope = selection.scope === OFFER_SCOPES.EVENT ? OFFER_SCOPES.EVENT : OFFER_SCOPES.FEST;
    const scopedKey = `${scope}:${selection.offerKey}`;
    const entry = offersByScopedKey.get(scopedKey);
    if (!entry || reservedKeys.includes(selection.offerKey) || seenScopedKeys.has(scopedKey)) {
      continue;
    }
    seenScopedKeys.add(scopedKey);
    const { offer } = entry;

    const numberOfPeople = resolveAxisValue(
      offer,
      offer.collectsNumberOfPeople,
      selection.numberOfPeople,
      offer.numberOfPeopleMinimum,
      offer.numberOfPeopleMaximum,
      "number of people",
      peopleCeiling
    );
    const numberOfDays = resolveAxisValue(
      offer,
      offer.collectsNumberOfDays,
      selection.numberOfDays,
      offer.numberOfDaysMinimum,
      offer.numberOfDaysMaximum,
      "number of days",
      OFFER_QUANTITY_SANITY_MAXIMUM
    );

    resolvedSelections.push({
      offerId: offer._id,
      offerKey: offer.offerKey,
      scope,
      numberOfPeople,
      numberOfDays,
    });
  }
  return resolvedSelections;
}

module.exports = {
  listActiveOffers,
  resolveFoodPreference,
  resolveAccommodationNeed,
  resolveFoodOrderCount,
  resolveOfferSelections,
};
