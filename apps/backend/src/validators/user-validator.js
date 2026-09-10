const mongoose = require("mongoose");

const { ERROR_CODES } = require("../constants/error-codes");

const FULL_NAME_MIN_LENGTH = 2;
const USN_MIN_LENGTH = 5;
const YEAR_OF_STUDY_MIN = 1;
const YEAR_OF_STUDY_MAX = 6;
const DEPARTMENT_MAX_LENGTH = 100;

function buildValidationFailure(details) {
  return {
    ok: false,
    error: { code: ERROR_CODES.VALIDATION_FAILED, message: "One or more fields are invalid.", details },
  };
}

function parseFullName(rawValue, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length < FULL_NAME_MIN_LENGTH) {
    details.fullName = `must be at least ${FULL_NAME_MIN_LENGTH} characters`;
    return undefined;
  }
  return rawValue.trim();
}

function parseCollegeId(rawValue, details) {
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    details.collegeId = "must be a valid college";
    return undefined;
  }
  return rawValue;
}

function parseUsn(rawValue, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length < USN_MIN_LENGTH) {
    details.usn = `must be at least ${USN_MIN_LENGTH} characters`;
    return undefined;
  }
  return rawValue.trim().toUpperCase();
}

/*
 * Required, non-empty string only: regional and international phone formats vary
 * too widely to validate further, and profile completion now depends on it.
 */
function parsePhoneNumber(rawValue, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    details.phoneNumber = "is required";
    return undefined;
  }
  return rawValue.trim();
}

/* Optional: only validated when present, and absent means "leave unset". */
function parseYearOfStudy(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (!Number.isInteger(rawValue) || rawValue < YEAR_OF_STUDY_MIN || rawValue > YEAR_OF_STUDY_MAX) {
    details.yearOfStudy = `must be a whole number from ${YEAR_OF_STUDY_MIN} to ${YEAR_OF_STUDY_MAX}`;
    return undefined;
  }
  return rawValue;
}

/*
 * Free text by design — the frontend offers a suggestion list, but any typed
 * department is valid, so no enum here. Whitespace runs collapse to a single
 * space and only the length cap is enforced.
 */
function parseDepartment(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string") {
    details.department = "must be a string";
    return undefined;
  }
  const normalised = rawValue.replace(/\s+/g, " ").trim();
  if (normalised.length > DEPARTMENT_MAX_LENGTH) {
    details.department = `must be at most ${DEPARTMENT_MAX_LENGTH} characters`;
    return undefined;
  }
  return normalised.length === 0 ? null : normalised;
}

/* Optional http(s) URL from the upload endpoint; absent/empty means "unset". */
function parseStudentIdUrl(rawValue, details) {
  /* Same absent-vs-clear rule as the avatar: see parseProfilePictureUrl. */
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  if (typeof rawValue !== "string" || rawValue.length > 2048 || !/^https?:\/\//.test(rawValue.trim())) {
    details.studentIdUrl = "must be an http(s) URL";
    return undefined;
  }
  return rawValue.trim();
}

/* Optional avatar path — a relative URL to a pre-set avatar image. */
function parseProfilePictureUrl(rawValue, details) {
  /*
   * ABSENT means "leave unchanged", not "clear". Collapsing undefined into
   * null made every profile PATCH that didn't mention the avatar (profile
   * completion, edit profile) silently wipe it in the database — the person
   * picked an avatar, then lost it on their next profile save and it looked
   * like the avatar "didn't stick" across sessions. Explicit null/"" still
   * clears, so removing an avatar remains possible.
   */
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  if (typeof rawValue !== "string" || rawValue.length > 2048) {
    details.profilePictureUrl = "must be a string under 2048 characters";
    return undefined;
  }
  return rawValue.trim();
}

/*
 * A DENYLIST of consumer mail hosts, not an allowlist of academic suffixes.
 *
 * Indian institutions sit on .ac.in, .edu.in, .edu, .org, .com and a long tail of
 * their own vanity domains; an allowlist of ".edu/.ac.in" would reject a real
 * college address far more often than it caught a personal one. The failure this
 * field guards against is someone typing their gmail again, and that is a short,
 * knowable list.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "live.com",
  "rediffmail.com",
  "zoho.com",
]);

function parseProfessionalEmail(rawValue, details) {
  /* Same absent-vs-clear rule as the avatar: see parseProfilePictureUrl. */
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  if (typeof rawValue !== "string") {
    details.professionalEmail = "must be a string";
    return undefined;
  }
  const trimmed = rawValue.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
    details.professionalEmail = "must be a valid email address";
    return undefined;
  }
  const domain = trimmed.slice(trimmed.lastIndexOf("@") + 1);
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    details.professionalEmail = "must be an institutional address, not a personal one";
    return undefined;
  }
  return trimmed;
}

/*
 * Optional. undefined = absent (leave as is), null/"" = explicit clear. A
 * value must be a calendar date "YYYY-MM-DD"; it is stored as UTC midnight so
 * the date a person typed is the date we keep, whatever the server's zone.
 * Not in the future, and not implausibly old.
 */
const DATE_OF_BIRTH_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_OF_BIRTH_MAX_AGE_YEARS = 130;

function parseDateOfBirth(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  const match = typeof rawValue === "string" ? DATE_OF_BIRTH_PATTERN.exec(rawValue.trim()) : null;
  if (!match) {
    details.dateOfBirth = "must be a date in YYYY-MM-DD form";
    return undefined;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealCalendarDate) {
    details.dateOfBirth = "must be a real calendar date";
    return undefined;
  }
  const now = new Date();
  if (date.getTime() > now.getTime()) {
    details.dateOfBirth = "must not be in the future";
    return undefined;
  }
  if (now.getUTCFullYear() - year > DATE_OF_BIRTH_MAX_AGE_YEARS) {
    details.dateOfBirth = "is not a plausible date of birth";
    return undefined;
  }
  return date;
}

/*
 * The version id a consent tick was made against. Optional on its own —
 * absent, null or "" reads as "not sent" — but REQUIRED beside a tick: a tick
 * that cannot say which text it was ticked against is refused here, before
 * anything is recorded. An id sent without its tick is simply ignored.
 */
function parsePolicyVersionId(rawValue, fieldName, isTicked, details) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (isTicked) {
      details[fieldName] = "is required when the matching consent is ticked";
    }
    return null;
  }
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    details[fieldName] = "must be a valid policy version id";
    return null;
  }
  return isTicked ? rawValue : null;
}

function validateUpdateProfilePayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const fullName = parseFullName(requestBody.fullName, details);
  const collegeId = parseCollegeId(requestBody.collegeId, details);
  const usn = parseUsn(requestBody.usn, details);
  const phoneNumber = parsePhoneNumber(requestBody.phoneNumber, details);
  const yearOfStudy = parseYearOfStudy(requestBody.yearOfStudy, details);
  const department = parseDepartment(requestBody.department, details);
  const studentIdUrl = parseStudentIdUrl(requestBody.studentIdUrl, details);
  const professionalEmail = parseProfessionalEmail(requestBody.professionalEmail, details);
  const profilePictureUrl = parseProfilePictureUrl(requestBody.profilePictureUrl, details);
  const dateOfBirth = parseDateOfBirth(requestBody.dateOfBirth, details);
  /* Consent arrives as booleans; anything not exactly true is treated as not
   * given. No error when absent — the profile form sends them, other partial
   * updates legitimately do not. */
  const hasAcceptedTerms = requestBody.hasAcceptedTerms === true;
  const hasAcceptedPrivacyPolicy = requestBody.hasAcceptedPrivacyPolicy === true;
  const termsPolicyVersionId = parsePolicyVersionId(
    requestBody.termsPolicyVersionId,
    "termsPolicyVersionId",
    hasAcceptedTerms,
    details
  );
  const privacyPolicyVersionId = parsePolicyVersionId(
    requestBody.privacyPolicyVersionId,
    "privacyPolicyVersionId",
    hasAcceptedPrivacyPolicy,
    details
  );

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      fullName,
      collegeId,
      usn,
      phoneNumber,
      yearOfStudy,
      department,
      studentIdUrl,
      professionalEmail,
      profilePictureUrl,
      dateOfBirth,
      hasAcceptedTerms,
      hasAcceptedPrivacyPolicy,
      termsPolicyVersionId,
      privacyPolicyVersionId,
    },
  };
}

module.exports = { validateUpdateProfilePayload };
