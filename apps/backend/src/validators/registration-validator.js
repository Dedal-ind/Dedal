const validator = require("validator");

const { ERROR_CODES } = require("../constants/error-codes");
const {
  TEAM_NAME_MIN_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  MEMBER_EMAILS_MAX,
} = require("../constants/registration-constants");

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
 * Shape-only: that this is a list of { questionId, ... } objects. Whether an
 * answer is valid depends on the event's questions, which this layer cannot see,
 * so the registration service checks it against them.
 */
function parseCustomResponses(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue)) {
    details.customResponses = "must be an array";
    return undefined;
  }

  for (const candidate of rawValue) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      details.customResponses = "every entry must be an object";
      return undefined;
    }
    if (typeof candidate.questionId !== "string" || candidate.questionId.trim().length === 0) {
      details.customResponses = "every entry needs a questionId";
      return undefined;
    }
  }
  return rawValue;
}

/*
 * Optional per-registration contact phone. Same looseness as the profile's own
 * phone (validated as little as user-validator does) with a light E.164-ish
 * sanity check. Absent/blank → null → "use the account phone".
 */
const CONTACT_PHONE_PATTERN = /^\+?[0-9][0-9 \-]{3,18}[0-9]$/;

function parseContactPhoneOverride(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string") {
    details.contactPhoneOverride = "must be a string";
    return undefined;
  }
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    return null;
  }
  if (!CONTACT_PHONE_PATTERN.test(trimmedValue)) {
    details.contactPhoneOverride =
      "must be a phone number (digits, spaces, dashes, optional leading +)";
    return undefined;
  }
  return trimmedValue;
}

/*
 * Shape only. Whether the event actually demands acceptance is the service's to
 * decide, since only it has the event — this just refuses a non-boolean rather
 * than letting a truthy "false" string read as consent.
 */
function parseAcceptanceFlag(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "boolean") {
    details.hasAcceptedMedicalDeclaration = "must be a boolean";
    return undefined;
  }
  return rawValue;
}

/*
 * Shape only for both preference fields. The enum for food and the fest-offers
 * question both live in the service, which has the fest this layer cannot see; the
 * validator just refuses a non-string food value or a non-boolean accommodation
 * flag so a bad type never reaches the helper.
 */
function parseFoodPreference(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "string") {
    details.foodPreference = "must be a string";
    return undefined;
  }
  return rawValue;
}

function parseNeedsAccommodation(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "boolean") {
    details.needsAccommodation = "must be a boolean";
    return undefined;
  }
  return rawValue;
}

/*
 * Shape only, matching parseFoodPreference: whether the fest offers food and what
 * range the count may take both live in the resolver, which has the fest and
 * event this layer cannot see. This just refuses a non-integer.
 */
function parseFoodOrderCount(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Number.isInteger(rawValue)) {
    details.foodOrderCount = "must be a whole number";
    return undefined;
  }
  return rawValue;
}

/*
 * Shape only, like parseFoodPreference: whether an offerKey names a real, active,
 * non-reserved offer — and what quantity it may take — is the resolver's call,
 * which has the fest this layer cannot see.
 */
function parseOfferSelections(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue)) {
    details.offerSelections = "must be an array";
    return undefined;
  }
  for (const candidate of rawValue) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      details.offerSelections = "every entry must be an object";
      return undefined;
    }
    if (typeof candidate.offerKey !== "string" || candidate.offerKey.trim().length === 0) {
      details.offerSelections = "every entry needs an offerKey";
      return undefined;
    }
    if (candidate.scope !== undefined && !["fest", "event"].includes(candidate.scope)) {
      details.offerSelections = "scope must be 'fest' or 'event'";
      return undefined;
    }
    for (const axisField of ["numberOfPeople", "numberOfDays"]) {
      if (candidate[axisField] !== undefined && !Number.isInteger(candidate[axisField])) {
        details.offerSelections = `${axisField} must be a whole number`;
        return undefined;
      }
    }
  }
  return rawValue;
}

/* Solo registration carries only its answers; unknown fields are silently dropped. */
function validateSoloRegistrationPayload(requestBody) {
  if (requestBody === undefined || requestBody === null) {
    return { ok: true, value: {} };
  }
  if (typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const customResponses = parseCustomResponses(requestBody.customResponses, details);
  const hasAcceptedMedicalDeclaration = parseAcceptanceFlag(
    requestBody.hasAcceptedMedicalDeclaration,
    details
  );
  const foodPreference = parseFoodPreference(requestBody.foodPreference, details);
  const needsAccommodation = parseNeedsAccommodation(requestBody.needsAccommodation, details);
  const foodOrderCount = parseFoodOrderCount(requestBody.foodOrderCount, details);
  const offerSelections = parseOfferSelections(requestBody.offerSelections, details);
  const contactPhoneOverride = parseContactPhoneOverride(requestBody.contactPhoneOverride, details);

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      customResponses,
      hasAcceptedMedicalDeclaration,
      foodPreference,
      needsAccommodation,
      foodOrderCount,
      offerSelections,
      contactPhoneOverride,
    },
  };
}

function parseTeamName(rawValue, details) {
  if (typeof rawValue !== "string") {
    details.teamName = "is required";
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length < TEAM_NAME_MIN_LENGTH || trimmed.length > TEAM_NAME_MAX_LENGTH) {
    details.teamName = `must be between ${TEAM_NAME_MIN_LENGTH} and ${TEAM_NAME_MAX_LENGTH} characters`;
    return undefined;
  }
  return trimmed;
}

/* Normalised to lowercase and de-duplicated case-insensitively, since that is how the index matches. */
function parseMemberEmails(rawValue, details) {
  if (!Array.isArray(rawValue)) {
    details.memberEmails = "must be an array";
    return undefined;
  }
  if (rawValue.length > MEMBER_EMAILS_MAX) {
    details.memberEmails = `must not exceed ${MEMBER_EMAILS_MAX} members`;
    return undefined;
  }

  const uniqueEmails = [];
  for (const candidate of rawValue) {
    if (typeof candidate !== "string" || !validator.isEmail(candidate.trim())) {
      details.memberEmails = "every entry must be a valid email address";
      return undefined;
    }
    const normalised = candidate.trim().toLowerCase();
    if (!uniqueEmails.includes(normalised)) {
      uniqueEmails.push(normalised);
    }
  }
  return uniqueEmails;
}

function validateTeamRegistrationPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const teamName = parseTeamName(requestBody.teamName, details);
  const memberEmails = parseMemberEmails(requestBody.memberEmails, details);
  const customResponses = parseCustomResponses(requestBody.customResponses, details);
  const hasAcceptedMedicalDeclaration = parseAcceptanceFlag(
    requestBody.hasAcceptedMedicalDeclaration,
    details
  );
  const foodPreference = parseFoodPreference(requestBody.foodPreference, details);
  const needsAccommodation = parseNeedsAccommodation(requestBody.needsAccommodation, details);
  const foodOrderCount = parseFoodOrderCount(requestBody.foodOrderCount, details);
  const offerSelections = parseOfferSelections(requestBody.offerSelections, details);
  const contactPhoneOverride = parseContactPhoneOverride(requestBody.contactPhoneOverride, details);

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      teamName,
      memberEmails,
      customResponses,
      hasAcceptedMedicalDeclaration,
      foodPreference,
      needsAccommodation,
      foodOrderCount,
      offerSelections,
      contactPhoneOverride,
    },
  };
}

module.exports = {
  validateSoloRegistrationPayload,
  validateTeamRegistrationPayload,
  // Shared with team-validator.js so the code-path payloads parse identically.
  parseCustomResponses,
  parseAcceptanceFlag,
  parseFoodPreference,
  parseNeedsAccommodation,
  parseFoodOrderCount,
  parseOfferSelections,
};
