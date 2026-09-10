const { ERROR_CODES } = require("../constants/error-codes");
const { parseCollegeAddress } = require("./college-address-validator");

/*
 * city and state stay required here: they are the display summary the
 * participant college picker reads, and the model's pre-save hook rewrites them
 * from the address anyway. isVerified is deliberately ABSENT from every list —
 * verification is a platform-admin decision, never a self-service field on the
 * way in.
 */
const REQUIRED_STRING_FIELDS = ["collegeName", "commonName", "city", "state"];
const OPTIONAL_STRING_FIELDS = ["aisheCode", "contactEmail"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRegisterCollegePayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return { ok: false, error: fail({ body: "must be a JSON object" }) };
  }

  const details = {};
  const value = {};

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(requestBody[field])) {
      details[field] = "is required";
    } else {
      value[field] = requestBody[field].trim();
    }
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (requestBody[field] === undefined || requestBody[field] === null || requestBody[field] === "") {
      continue;
    }
    if (!isNonEmptyString(requestBody[field])) {
      details[field] = "must be a non-empty string";
    } else {
      value[field] = requestBody[field].trim();
    }
  }

  // The structured postal address is mandatory on registration.
  const address = parseCollegeAddress(requestBody.address, details);
  if (address) {
    value.address = address;
  }

  if (Object.keys(details).length > 0) {
    return { ok: false, error: fail(details) };
  }
  return { ok: true, value };
}

function fail(details) {
  return { code: ERROR_CODES.VALIDATION_FAILED, message: "One or more fields are invalid.", details };
}

module.exports = { validateRegisterCollegePayload };
