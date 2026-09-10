const mongoose = require("mongoose");

const { ERROR_CODES } = require("../constants/error-codes");
const {
  CONTINGENT_NAME_MAX_LENGTH,
  CONTINGENT_EVENTS_MINIMUM,
  CONTINGENT_EVENTS_MAXIMUM,
} = require("../constants/contingent-constants");

const DESCRIPTION_MAX_LENGTH = 500;
const ATTENDEE_NAME_MIN_LENGTH = 2;
const { EMAIL_ADDRESS_PATTERN } = require("@dedal/shared");

function buildValidationFailure(details) {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "One or more fields are invalid.",
      details,
    },
  };
}

function parseContingentName(rawValue, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    details.contingentName = "is required";
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length > CONTINGENT_NAME_MAX_LENGTH) {
    details.contingentName = `must be at most ${CONTINGENT_NAME_MAX_LENGTH} characters`;
    return undefined;
  }
  return trimmed;
}

function parseDescription(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string" || rawValue.trim().length > DESCRIPTION_MAX_LENGTH) {
    details.description = `must be a string of at most ${DESCRIPTION_MAX_LENGTH} characters`;
    return undefined;
  }
  const trimmed = rawValue.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseIncludedEventIds(rawValue, details) {
  if (!Array.isArray(rawValue)) {
    details.includedEventIds = "must be an array of event ids";
    return undefined;
  }
  const invalidEntry = rawValue.find(
    (candidateId) =>
      typeof candidateId !== "string" || !mongoose.Types.ObjectId.isValid(candidateId)
  );
  if (invalidEntry !== undefined) {
    details.includedEventIds = "every entry must be a valid event id";
    return undefined;
  }
  const uniqueIds = [...new Set(rawValue)];
  if (
    uniqueIds.length < CONTINGENT_EVENTS_MINIMUM ||
    uniqueIds.length > CONTINGENT_EVENTS_MAXIMUM
  ) {
    details.includedEventIds = `must name between ${CONTINGENT_EVENTS_MINIMUM} and ${CONTINGENT_EVENTS_MAXIMUM} distinct sub-events`;
    return undefined;
  }
  return uniqueIds;
}

function parsePricePaise(rawValue, details) {
  if (!Number.isInteger(rawValue) || rawValue < 0) {
    details.pricePaise = "must be an integer amount in paise, zero or more";
    return undefined;
  }
  return rawValue;
}

function parseMaximumBundleClaims(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (!Number.isInteger(rawValue) || rawValue < 1) {
    details.maximumBundleClaims = "must be a whole number of at least 1, or null";
    return undefined;
  }
  return rawValue;
}

function parseAllowNegativeDiscount(rawValue) {
  return rawValue === true;
}

/*
 * null (or absent) is a MEANINGFUL value, not a missing one: it says the bundle
 * is scoped to the fest itself rather than to a container event, which is how a
 * two-layer fest (fest → events) sells a contingent. Only a non-null value that
 * is not an event id is an error.
 */
function parseParentEventId(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    details.parentEventId = "must be a valid event id, or null for a fest-level contingent";
    return undefined;
  }
  return rawValue;
}

function validateCreateContingentPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const parentEventId = parseParentEventId(requestBody.parentEventId, details);
  const contingentName = parseContingentName(requestBody.contingentName, details);
  const description = parseDescription(requestBody.description, details);
  const includedEventIds = parseIncludedEventIds(requestBody.includedEventIds, details);
  const pricePaise = parsePricePaise(requestBody.pricePaise, details);
  const maximumBundleClaims = parseMaximumBundleClaims(requestBody.maximumBundleClaims, details);
  const allowNegativeDiscount = parseAllowNegativeDiscount(requestBody.allowNegativeDiscount);

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      parentEventId,
      contingentName,
      description,
      includedEventIds,
      pricePaise,
      maximumBundleClaims,
      allowNegativeDiscount,
    },
  };
}

/*
 * PATCH accepts a subset; which fields the service will actually apply depends
 * on the contingent's state (name/description always; the rest only while DRAFT
 * with zero claims — see assertContingentEditable).
 */
function validateUpdateContingentPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {};

  if (requestBody.contingentName !== undefined) {
    value.contingentName = parseContingentName(requestBody.contingentName, details);
  }
  if (requestBody.description !== undefined) {
    value.description = parseDescription(requestBody.description, details);
  }
  if (requestBody.includedEventIds !== undefined) {
    value.includedEventIds = parseIncludedEventIds(requestBody.includedEventIds, details);
  }
  if (requestBody.pricePaise !== undefined) {
    value.pricePaise = parsePricePaise(requestBody.pricePaise, details);
  }
  if (requestBody.maximumBundleClaims !== undefined) {
    value.maximumBundleClaims = parseMaximumBundleClaims(requestBody.maximumBundleClaims, details);
  }
  value.allowNegativeDiscount = parseAllowNegativeDiscount(requestBody.allowNegativeDiscount);

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

/*
 * One attendee row per included sub-event. The purchase endpoint receives
 * { attendees: [{ eventId, fullName, emailAddress, phoneNumber }] } and the
 * service checks the eventId set matches the contingent exactly.
 */
function parseAttendeeRow(rawRow, rowIndex, details) {
  if (rawRow === null || typeof rawRow !== "object") {
    details[`attendees[${rowIndex}]`] = "must be an object";
    return undefined;
  }
  const rowDetails = {};
  const eventId =
    typeof rawRow.eventId === "string" && mongoose.Types.ObjectId.isValid(rawRow.eventId)
      ? rawRow.eventId
      : undefined;
  if (eventId === undefined) {
    rowDetails.eventId = "must be a valid event id";
  }
  const fullName =
    typeof rawRow.fullName === "string" && rawRow.fullName.trim().length >= ATTENDEE_NAME_MIN_LENGTH
      ? rawRow.fullName.trim()
      : undefined;
  if (fullName === undefined) {
    rowDetails.fullName = `must be at least ${ATTENDEE_NAME_MIN_LENGTH} characters`;
  }
  const emailAddress =
    typeof rawRow.emailAddress === "string" &&
    EMAIL_ADDRESS_PATTERN.test(rawRow.emailAddress.trim())
      ? rawRow.emailAddress.trim().toLowerCase()
      : undefined;
  if (emailAddress === undefined) {
    rowDetails.emailAddress = "must be a valid email address";
  }
  // Same permissive rule as the profile validator: formats vary too widely to
  // validate beyond presence.
  const phoneNumber =
    typeof rawRow.phoneNumber === "string" && rawRow.phoneNumber.trim().length > 0
      ? rawRow.phoneNumber.trim()
      : undefined;
  if (phoneNumber === undefined) {
    rowDetails.phoneNumber = "is required";
  }

  if (Object.keys(rowDetails).length > 0) {
    details[`attendees[${rowIndex}]`] = rowDetails;
    return undefined;
  }
  return { eventId, fullName, emailAddress, phoneNumber };
}

function validatePurchaseContingentPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  if (!Array.isArray(requestBody.attendees) || requestBody.attendees.length === 0) {
    return buildValidationFailure({ attendees: "must be a non-empty array" });
  }
  const details = {};
  const attendees = requestBody.attendees.map((rawRow, rowIndex) =>
    parseAttendeeRow(rawRow, rowIndex, details)
  );
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value: { attendees } };
}

module.exports = {
  validateCreateContingentPayload,
  validateUpdateContingentPayload,
  validatePurchaseContingentPayload,
};
