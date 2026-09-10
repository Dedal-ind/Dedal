const mongoose = require("mongoose");
const validator = require("validator");
const {
  EVENT_CATEGORY_MAX_LENGTH,
  EVENT_TYPES,
  FEE_TYPES,
  EVENT_SCORING_FORMATS,
} = require("../constants/event-constants");
// Offers hang off a fest AND off one event; one shape, one parser.
const { parseOffers } = require("./offer-field-parsers");
// Sponsors do the same: one shape, one parser, a tighter cap at event level.
const { parseEventSponsors } = require("./sponsor-field-parsers");

/*
 * Each parser returns { value } on success or { reason } on failure. Nothing
 * throws: the validator collects reasons into a details map, and the controller
 * turns that into one 400. Mirrors fest-field-parsers.js.
 */
const parseTrimmedString = (rawValue) => {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return { reason: "must be a non-empty string" };
  }
  return { value: rawValue.trim() };
};

// An optional free-text field clears to null rather than to an empty string.
const parseOptionalTrimmedString = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  if (typeof rawValue !== "string") {
    return { reason: "must be a string" };
  }
  const trimmedValue = rawValue.trim();
  return { value: trimmedValue.length === 0 ? null : trimmedValue };
};

const parseUrl = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  // require_tld:false lets the dev upload service's localhost URLs pass (e.g.
  // http://localhost:5000/uploads/x.png); production S3 https URLs still validate
  // cleanly. protocols pins the scheme so only http(s) links are accepted.
  if (
    typeof rawValue !== "string" ||
    !validator.isURL(rawValue.trim(), { require_tld: false, protocols: ["http", "https"] })
  ) {
    return { reason: "must be a valid URL" };
  }
  return { value: rawValue.trim() };
};

const buildEnumParser = (allowedValuesObject) => (rawValue) => {
  const allowedValues = Object.values(allowedValuesObject);
  if (!allowedValues.includes(rawValue)) {
    return { reason: `must be one of: ${allowedValues.join(", ")}` };
  }
  return { value: rawValue };
};

/*
 * A category is optional: null (or an empty string) clears it, which is what a
 * container event carries.
 *
 * FREE TEXT — no enum check. EVENT_CATEGORIES is a suggestion list the admin UI
 * offers, not a whitelist; an organiser typing "Culinary Arts" must be able to
 * save it. Whitespace runs collapse to a single space so "Culinary   Arts" and
 * "Culinary Arts" do not become two distinct categories (the same normalisation
 * parseDepartment applies). Only the length cap can reject.
 */
const parseNullableCategory = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  if (typeof rawValue !== "string") {
    return { reason: "must be a string" };
  }
  const normalisedValue = rawValue.replace(/\s+/g, " ").trim();
  if (normalisedValue.length > EVENT_CATEGORY_MAX_LENGTH) {
    return { reason: `must be at most ${EVENT_CATEGORY_MAX_LENGTH} characters` };
  }
  return { value: normalisedValue.length === 0 ? null : normalisedValue };
};

const buildIntegerParser = (minimumValue) => (rawValue) => {
  if (!Number.isInteger(rawValue) || rawValue < minimumValue) {
    return { reason: `must be an integer of at least ${minimumValue}` };
  }
  return { value: rawValue };
};

// Capacity is the one number where null is meaningful: it means unlimited.
const parseNullableCapacity = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  return buildIntegerParser(1)(rawValue);
};

const parseBoolean = (rawValue) => {
  if (typeof rawValue !== "boolean") {
    return { reason: "must be a boolean" };
  }
  return { value: rawValue };
};

// Optional grouping parent. null keeps the event top-level; a string must be a
// valid ObjectId. Whether it exists and belongs to this fest is the service's check.
const parseNullableObjectId = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    return { reason: "must be a valid ObjectId or null" };
  }
  return { value: new mongoose.Types.ObjectId(rawValue) };
};

const parseDate = (rawValue) => {
  if (typeof rawValue !== "string" && !(rawValue instanceof Date)) {
    return { reason: "must be a valid ISO 8601 date" };
  }
  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return { reason: "must be a valid ISO 8601 date" };
  }
  return { value: parsedDate };
};

const parseStringArray = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return { reason: "must be an array" };
  }
  const parsedEntries = [];
  for (const candidateEntry of rawValue) {
    const parsed = parseTrimmedString(candidateEntry);
    if (parsed.reason) {
      return { reason: `every entry ${parsed.reason}` };
    }
    parsedEntries.push(parsed.value);
  }
  return { value: parsedEntries };
};

/*
 * The whitelist. festId, eventSlug, status, registeredCount, createdByUserId and
 * the Mongo bookkeeping fields are absent by design: the service owns them, and
 * a client that sends one has it dropped rather than rejected.
 */
const EVENT_FIELD_PARSERS = {
  eventName: parseTrimmedString,
  parentEventId: parseNullableObjectId,
  description: parseTrimmedString,
  rules: parseOptionalTrimmedString,
  posterImageUrl: parseUrl,
  category: parseNullableCategory,
  eventType: buildEnumParser(EVENT_TYPES),
  minimumTeamSize: buildIntegerParser(1),
  maximumTeamSize: buildIntegerParser(1),
  scoringFormat: buildEnumParser(EVENT_SCORING_FORMATS),
  feeType: buildEnumParser(FEE_TYPES),
  venue: parseTrimmedString,
  startsAt: parseDate,
  endsAt: parseDate,
  registrationOpensAt: parseDate,
  registrationClosesAt: parseDate,
  capacity: parseNullableCapacity,
  waitlistEnabled: parseBoolean,
  requiresMedicalDeclaration: parseBoolean,
  isLeaderboardVisible: parseBoolean,
  /*
   * Without this the admin's waitlist toggle would be silently DROPPED by the
   * whitelist above and the event would stay waitlistEnabled:false forever,
   * with no error to explain why. Every settable event field must appear here.
   */
  waitlistEnabled: parseBoolean,
  feeAmountPaise: buildIntegerParser(0),
  prizePoolDescription: parseOptionalTrimmedString,
  weightCategories: parseStringArray,
  genderCategories: parseStringArray,
  ageCategories: parseStringArray,
  // Event-scoped add-ons, a parallel to fest.offers (NOT a moved field): a
  // fest-wide "Food" and this event's "Food" are two offers at two rates.
  offers: parseOffers,
  // Event-scoped sponsor logos, a parallel to fest.sponsors (NOT a moved field):
  // an event may carry its own title sponsor alongside the fest-wide strip.
  sponsors: parseEventSponsors,
  // The event-level certificate artwork (admin certificates flow). Optional
  // http(s) URL; null clears it back to the fest-wide template.
  certificateTemplateUrl: parseUrl,
};

module.exports = { EVENT_FIELD_PARSERS };
