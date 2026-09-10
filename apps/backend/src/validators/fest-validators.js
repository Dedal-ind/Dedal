const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_FIELD_PARSERS } = require("../helpers/fest-field-parsers");

const CREATE_REQUIRED_FIELDS = [
  "festName",
  "hostCollegeId",
  "startsOn",
  "endsOn",
  "visibility",
];

// hostCollegeId is absent by design: a fest cannot be moved to another college.
const UPDATE_ALLOWED_FIELDS = [
  "festName",
  "description",
  "startsOn",
  "endsOn",
  "visibility",
  "allowedCollegeIds",
  "contactEmail",
  "contactPhone",
  "bannerImageUrl",
  "offers",
  // Sponsor logos ride the same whole-array PATCH the banner image does; there
  // is deliberately no separate sponsors endpoint.
  "sponsors",
  "certificateTemplate",
];

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

/*
 * Whitelist-only. A field outside allowedFields is dropped silently rather than
 * rejected, so a newer frontend sending an extra key keeps working against an
 * older backend.
 */
function validatePayload(requestBody, allowedFields, requiredFields) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const value = {};

  for (const fieldName of allowedFields) {
    if (requestBody[fieldName] === undefined) {
      continue;
    }
    const parsed = FEST_FIELD_PARSERS[fieldName](requestBody[fieldName]);
    if (parsed.reason) {
      details[fieldName] = parsed.reason;
    } else {
      value[fieldName] = parsed.value;
    }
  }

  for (const fieldName of requiredFields) {
    if (value[fieldName] === undefined && details[fieldName] === undefined) {
      details[fieldName] = "is required";
    }
  }

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateCreateFestPayload(requestBody) {
  return validatePayload(requestBody, Object.keys(FEST_FIELD_PARSERS), CREATE_REQUIRED_FIELDS);
}

function validateUpdateFestPayload(requestBody) {
  return validatePayload(requestBody, UPDATE_ALLOWED_FIELDS, []);
}

module.exports = { validateCreateFestPayload, validateUpdateFestPayload };
