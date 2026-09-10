const mongoose = require("mongoose");
const { FEST_VISIBILITIES } = require("../constants/fest-constants");
// Offers hang off a fest AND off an event, so their parser is shared rather
// than restated here (see helpers/offer-field-parsers.js).
const { parseOffers } = require("./offer-field-parsers");
// Sponsors hang off a fest AND off an event; one shape, one parser, two caps
// (see helpers/sponsor-field-parsers.js).
const { parseFestSponsors } = require("./sponsor-field-parsers");

/*
 * Each parser returns { value } on success or { reason } on failure. Nothing
 * throws: the validator collects reasons into a details map, and the controller
 * turns that into one 400.
 */
const parseTrimmedString = (rawValue) => {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return { reason: "must be a non-empty string" };
  }
  return { value: rawValue.trim() };
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

const parseObjectId = (rawValue) => {
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    return { reason: "must be a valid ObjectId" };
  }
  return { value: new mongoose.Types.ObjectId(rawValue) };
};

const parseVisibility = (rawValue) => {
  const allowedVisibilities = Object.values(FEST_VISIBILITIES);
  if (!allowedVisibilities.includes(rawValue)) {
    return { reason: `must be one of: ${allowedVisibilities.join(", ")}` };
  }
  return { value: rawValue };
};

// Accepts a non-empty string (a stored image URL) or null, which clears the banner.
const parseNullableString = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return { reason: "must be a non-empty string or null" };
  }
  return { value: rawValue.trim() };
};

const parseObjectIdArray = (rawValue) => {
  if (!Array.isArray(rawValue)) {
    return { reason: "must be an array" };
  }
  const parsedIds = [];
  for (const candidateId of rawValue) {
    const parsed = parseObjectId(candidateId);
    if (parsed.reason) {
      return { reason: `every entry ${parsed.reason}` };
    }
    parsedIds.push(parsed.value);
  }
  return { value: parsedIds };
};

/*
 * The certificate template: ONE uploaded document that IS the certificate
 * artwork (JPEG/PNG via the upload service). null clears it.
 */
const parseCertificateTemplate = (rawValue) => {
  if (rawValue === null) {
    return { value: null };
  }
  if (rawValue === undefined || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return { reason: "must be an object or null" };
  }
  const fieldValue = rawValue.documentTemplateUrl;
  if (fieldValue === undefined || fieldValue === null) {
    return { value: { documentTemplateUrl: null } };
  }
  if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
    return { value: { documentTemplateUrl: fieldValue.trim() } };
  }
  return { reason: "documentTemplateUrl must be a non-empty string or null" };
};

const FEST_FIELD_PARSERS = {
  festName: parseTrimmedString,
  hostCollegeId: parseObjectId,
  description: parseTrimmedString,
  startsOn: parseDate,
  endsOn: parseDate,
  visibility: parseVisibility,
  allowedCollegeIds: parseObjectIdArray,
  contactEmail: parseTrimmedString,
  contactPhone: parseTrimmedString,
  bannerImageUrl: parseNullableString,
  offers: parseOffers,
  sponsors: parseFestSponsors,
  certificateTemplate: parseCertificateTemplate,
};

module.exports = { FEST_FIELD_PARSERS };
