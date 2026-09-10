const { FEST_OFFERS_MAX } = require("../constants/fest-constants");
const { generateFestSlug } = require("./generate-fest-slug");
const {
  OFFER_NAME_MAX_LENGTH,
  OFFER_DESCRIPTION_MAX_LENGTH,
} = require("./offer-schema-helpers");

/*
 * The ONE offers parser, shared by the fest write path and the event write path
 * — offers have the same shape wherever they hang, so they have one validator.
 *
 * Contract matches every other parser in this codebase: { value } on success,
 * { reason } on failure; nothing throws, and the caller turns a reason into one
 * 400 with a field-level detail.
 *
 * offerKey is DERIVED with the same slugger fest slugs use (reused, never a
 * second implementation), so a client cannot submit a key of its own and claim
 * reserved behaviour. Duplicate-key rejection belongs to the model hook; this
 * parser owns shape, the size cap, and the isPaid/ratePaise cross-field rule.
 */
function parseBoundPair(candidate, minimumField, maximumField) {
  const minimumValue = candidate[minimumField];
  const maximumValue = candidate[maximumField];
  if (minimumValue !== undefined && (!Number.isInteger(minimumValue) || minimumValue < 1)) {
    return { reason: `${minimumField} must be a whole number of at least 1` };
  }
  if (
    maximumValue !== undefined &&
    maximumValue !== null &&
    (!Number.isInteger(maximumValue) || maximumValue < 1)
  ) {
    return { reason: `${maximumField} must be a whole number of at least 1, or null` };
  }
  const resolvedMinimum = minimumValue ?? 1;
  const resolvedMaximum = maximumValue ?? null;
  if (resolvedMaximum !== null && resolvedMaximum < resolvedMinimum) {
    return { reason: `${maximumField} must be at least ${minimumField}` };
  }
  return { value: { minimum: resolvedMinimum, maximum: resolvedMaximum } };
}

function parseOffers(rawValue) {
  if (!Array.isArray(rawValue)) {
    return { reason: "must be an array" };
  }
  if (rawValue.length > FEST_OFFERS_MAX) {
    return { reason: `must not exceed ${FEST_OFFERS_MAX} offers` };
  }

  const parsedOffers = [];
  for (const candidate of rawValue) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { reason: "every entry must be an object" };
    }
    if (typeof candidate.offerName !== "string" || candidate.offerName.trim().length === 0) {
      return { reason: "every entry needs a non-empty offerName" };
    }
    const offerName = candidate.offerName.trim();
    if (offerName.length > OFFER_NAME_MAX_LENGTH) {
      return { reason: `offerName must be at most ${OFFER_NAME_MAX_LENGTH} characters` };
    }
    for (const booleanField of ["isActive", "isPaid", "collectsNumberOfPeople", "collectsNumberOfDays"]) {
      if (candidate[booleanField] !== undefined && typeof candidate[booleanField] !== "boolean") {
        return { reason: `${booleanField} must be a boolean` };
      }
    }
    if (
      candidate.description !== undefined &&
      candidate.description !== null &&
      (typeof candidate.description !== "string" ||
        candidate.description.length > OFFER_DESCRIPTION_MAX_LENGTH)
    ) {
      return {
        reason: `description must be a string of at most ${OFFER_DESCRIPTION_MAX_LENGTH} characters`,
      };
    }

    /*
     * The cross-field rule the client asked for by name: a free offer's rate is
     * FORCED to zero whatever was sent (so a stale form cannot smuggle a price
     * past the toggle), and a paid offer without a positive rate is refused
     * rather than silently priced at nothing.
     */
    const isPaid = candidate.isPaid ?? true;
    if (candidate.ratePaise !== undefined && (!Number.isInteger(candidate.ratePaise) || candidate.ratePaise < 0)) {
      return { reason: "ratePaise must be a non-negative integer (paise)" };
    }
    const ratePaise = isPaid ? candidate.ratePaise ?? 0 : 0;
    if (isPaid && !(ratePaise > 0)) {
      return { reason: "a paid offer needs a ratePaise greater than 0 (or set isPaid false)" };
    }

    const peopleBounds = parseBoundPair(candidate, "numberOfPeopleMinimum", "numberOfPeopleMaximum");
    if (peopleBounds.reason) {
      return peopleBounds;
    }
    const daysBounds = parseBoundPair(candidate, "numberOfDaysMinimum", "numberOfDaysMaximum");
    if (daysBounds.reason) {
      return daysBounds;
    }

    const offerKey = generateFestSlug(offerName);
    if (offerKey.length === 0) {
      return { reason: "every offerName must contain letters or digits" };
    }

    parsedOffers.push({
      offerName,
      offerKey,
      isActive: candidate.isActive ?? true,
      isPaid,
      ratePaise,
      collectsNumberOfPeople: candidate.collectsNumberOfPeople ?? false,
      numberOfPeopleMinimum: peopleBounds.value.minimum,
      numberOfPeopleMaximum: peopleBounds.value.maximum,
      collectsNumberOfDays: candidate.collectsNumberOfDays ?? false,
      numberOfDaysMinimum: daysBounds.value.minimum,
      numberOfDaysMaximum: daysBounds.value.maximum,
      description: candidate.description?.trim?.() || null,
    });
  }
  return { value: parsedOffers };
}

module.exports = { parseOffers };
