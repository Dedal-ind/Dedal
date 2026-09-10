const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The structured college address, validated once and shared by every entry
 * point that captures one (direct college registration and the college
 * application form), so the two can never disagree about what a valid address
 * is.
 *
 * PIN CODE: first digit 1–8 per India Post zone codes — 0 and 9 are not
 * allocated, so a bare \d{6} would accept 900,000 combinations of which only
 * about 19,000 exist. This is FORMAT validation, deliberately not postal
 * delivery verification: for zero false positives see
 * captn3m0/india-pincode-regex (npm), which ships a ~32KB regex of real
 * allocated ranges. Not added — the dependency is not worth carrying to catch
 * a typo the verifier will see on the proof document anyway.
 */
const INDIAN_PIN_CODE_PATTERN = /^[1-9]\d{5}$/;

const REQUIRED_ADDRESS_FIELDS = [
  { name: "addressLine1", maximumLength: 200 },
  { name: "city", maximumLength: 100 },
  { name: "state", maximumLength: 100 },
];

/*
 * district, addressLine3 and addressLine4 are OPTIONAL rather than removed.
 *
 * The registration form no longer asks for them — city, state and PIN identify
 * an Indian address without a district, and four address lines were producing
 * three empty boxes on almost every application. They stay accepted here, and
 * stay on the model, because applications already submitted carry them and a
 * reviewer opening an old one must still see the address that was entered.
 */
const OPTIONAL_ADDRESS_FIELDS = [
  { name: "addressLine2", maximumLength: 200 },
  { name: "addressLine3", maximumLength: 200 },
  { name: "addressLine4", maximumLength: 200 },
  { name: "district", maximumLength: 100 },
  { name: "townOrLocality", maximumLength: 100 },
];

const DEFAULT_COUNTRY = "India";
const COUNTRY_MAXIMUM_LENGTH = 100;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * Parses an address object into `details` (per-field complaints, prefixed so a
 * caller can show them against the right input) and returns the cleaned value,
 * or undefined when anything was wrong. `fieldPrefix` lets the application form
 * report "address.pinCode" while a direct registration reports "pinCode".
 */
function parseCollegeAddress(rawAddress, details, fieldPrefix = "") {
  const key = (fieldName) => `${fieldPrefix}${fieldName}`;

  if (rawAddress === null || typeof rawAddress !== "object" || Array.isArray(rawAddress)) {
    details[fieldPrefix ? fieldPrefix.replace(/\.$/, "") : "address"] = "is required";
    return undefined;
  }

  const address = {};

  for (const { name, maximumLength } of REQUIRED_ADDRESS_FIELDS) {
    if (!isNonEmptyString(rawAddress[name])) {
      details[key(name)] = "is required";
      continue;
    }
    const trimmedValue = rawAddress[name].trim();
    if (trimmedValue.length > maximumLength) {
      details[key(name)] = `must be at most ${maximumLength} characters`;
      continue;
    }
    address[name] = trimmedValue;
  }

  // Absent, null and "" all mean "not provided" and are stored as null.
  for (const { name, maximumLength } of OPTIONAL_ADDRESS_FIELDS) {
    const rawValue = rawAddress[name];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      address[name] = null;
      continue;
    }
    if (typeof rawValue !== "string") {
      details[key(name)] = "must be a string";
      continue;
    }
    const trimmedValue = rawValue.trim();
    if (trimmedValue.length === 0) {
      address[name] = null;
      continue;
    }
    if (trimmedValue.length > maximumLength) {
      details[key(name)] = `must be at most ${maximumLength} characters`;
      continue;
    }
    address[name] = trimmedValue;
  }

  if (!isNonEmptyString(rawAddress.pinCode)) {
    details[key("pinCode")] = "is required";
  } else if (!INDIAN_PIN_CODE_PATTERN.test(rawAddress.pinCode.trim())) {
    details[key("pinCode")] = "must be a valid 6-digit Indian PIN code (first digit 1–8)";
  } else {
    address.pinCode = rawAddress.pinCode.trim();
  }

  // The platform is India-only (USN, AISHE); country is a formality that
  // defaults rather than a question worth asking.
  if (rawAddress.country === undefined || rawAddress.country === null || rawAddress.country === "") {
    address.country = DEFAULT_COUNTRY;
  } else if (!isNonEmptyString(rawAddress.country)) {
    details[key("country")] = "must be a non-empty string";
  } else if (rawAddress.country.trim().length > COUNTRY_MAXIMUM_LENGTH) {
    details[key("country")] = `must be at most ${COUNTRY_MAXIMUM_LENGTH} characters`;
  } else {
    address.country = rawAddress.country.trim();
  }

  return Object.keys(details).length > 0 ? undefined : address;
}

function buildAddressValidationFailure(details) {
  return {
    code: ERROR_CODES.VALIDATION_FAILED,
    message: "One or more fields are invalid.",
    details,
  };
}

module.exports = {
  parseCollegeAddress,
  buildAddressValidationFailure,
  INDIAN_PIN_CODE_PATTERN,
  DEFAULT_COUNTRY,
};
