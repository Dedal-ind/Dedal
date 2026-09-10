const validator = require("validator");

const { ERROR_CODES } = require("../constants/error-codes");
const { EXPECTED_FEST_SIZES } = require("../models/college-application-model");
const { parseCollegeAddress } = require("./college-address-validator");

const REQUIRED_STRING_FIELDS = [
  "applicantEmail",
  "applicantFullName",
  "applicantPhone",
  "applicantRole",
  "collegeName",
  "collegeAddress",
  "collegeCity",
];

const MAXIMUM_DOCUMENT_URL_COUNT = 3;
const MAXIMUM_NOTES_LENGTH = 2000;

// Ten digits, optionally prefixed with +91. Spaces and hyphens are stripped first.
const INDIAN_MOBILE_PATTERN = /^(?:\+91)?[6-9][0-9]{9}$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(details) {
  return {
    code: ERROR_CODES.VALIDATION_FAILED,
    message: "One or more fields are invalid.",
    details,
  };
}

function validateSubmitApplicationPayload(requestBody) {
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

  /*
   * The structured address, reported under "address.<field>" so the form can
   * show each complaint against its own input. collegeAddress (the free-text
   * line) is kept alongside for the applications already in flight and for the
   * verifier's at-a-glance summary.
   */
  const collegeAddressDetail = parseCollegeAddress(requestBody.address, details, "address.");
  if (collegeAddressDetail) {
    value.collegeAddressDetail = collegeAddressDetail;
  }

  if (value.applicantEmail && !validator.isEmail(value.applicantEmail)) {
    details.applicantEmail = "must be a valid email address";
  }

  if (value.applicantPhone) {
    const normalizedPhone = value.applicantPhone.replace(/[\s-]/g, "");
    if (!INDIAN_MOBILE_PATTERN.test(normalizedPhone)) {
      details.applicantPhone = "must be a 10-digit Indian mobile number (optionally prefixed with +91)";
    } else {
      value.applicantPhone = normalizedPhone;
    }
  }

  // Optional; defaults to Karnataka in the model when absent.
  if (requestBody.collegeState !== undefined && requestBody.collegeState !== null && requestBody.collegeState !== "") {
    if (!isNonEmptyString(requestBody.collegeState)) {
      details.collegeState = "must be a non-empty string";
    } else {
      value.collegeState = requestBody.collegeState.trim();
    }
  }

  if (!EXPECTED_FEST_SIZES.includes(requestBody.expectedFestSize)) {
    details.expectedFestSize = `must be one of: ${EXPECTED_FEST_SIZES.join(", ")}`;
  } else {
    value.expectedFestSize = requestBody.expectedFestSize;
  }

  const website = requestBody.collegeWebsite;
  if (website !== undefined && website !== null && website !== "") {
    if (!isNonEmptyString(website) || !validator.isURL(website.trim(), { require_protocol: false })) {
      details.collegeWebsite = "must be a valid URL";
    } else {
      value.collegeWebsite = website.trim();
    }
  }

  const notes = requestBody.notesFromApplicant;
  if (notes !== undefined && notes !== null && notes !== "") {
    if (typeof notes !== "string") {
      details.notesFromApplicant = "must be a string";
    } else if (notes.trim().length > MAXIMUM_NOTES_LENGTH) {
      details.notesFromApplicant = `must be at most ${MAXIMUM_NOTES_LENGTH} characters`;
    } else {
      value.notesFromApplicant = notes.trim();
    }
  }

  const documentUrls = requestBody.documentUrls;
  if (documentUrls !== undefined && documentUrls !== null) {
    if (!Array.isArray(documentUrls)) {
      details.documentUrls = "must be an array of strings";
    } else if (documentUrls.length > MAXIMUM_DOCUMENT_URL_COUNT) {
      details.documentUrls = `must contain at most ${MAXIMUM_DOCUMENT_URL_COUNT} entries`;
    } else if (!documentUrls.every((url) => isNonEmptyString(url))) {
      details.documentUrls = "every entry must be a non-empty string";
    } else {
      value.documentUrls = documentUrls.map((url) => url.trim());
    }
  }

  if (Object.keys(details).length > 0) {
    return { ok: false, error: fail(details) };
  }
  return { ok: true, value };
}

module.exports = { validateSubmitApplicationPayload };
