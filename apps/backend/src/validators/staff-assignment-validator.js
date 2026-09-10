const mongoose = require("mongoose");
const validator = require("validator");

const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES } = require("../constants/staff-constants");
const { CHECKPOINT_TYPES } = require("../constants/scan-constants");

const ALLOWED_CHECKPOINT_TYPE_VALUES = Object.values(CHECKPOINT_TYPES);

/*
 * Administrator is deliberately absent. A college administrator is granted by
 * seeding or by another administrator at the college level, never invited into a
 * single fest, and the model's scope hook would reject the shape anyway.
 */
const ASSIGNABLE_ROLES = [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER];

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

/* Normalised here, so the lowercase form used for the unique index is what every caller sees. */
function parseEmailAddress(rawValue, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    details.emailAddress = "is required";
    return undefined;
  }
  const normalisedEmailAddress = rawValue.trim().toLowerCase();
  if (!validator.isEmail(normalisedEmailAddress)) {
    details.emailAddress = "must be a valid email address";
    return undefined;
  }
  return normalisedEmailAddress;
}

function parseRole(rawValue, details) {
  if (!ASSIGNABLE_ROLES.includes(rawValue)) {
    details.role = `must be one of: ${ASSIGNABLE_ROLES.join(", ")}`;
    return undefined;
  }
  return rawValue;
}

/* An absent array means "the whole fest", which is a legal assignment. */
function parseEventIds(rawValue, details) {
  if (rawValue === undefined) {
    return [];
  }
  if (!Array.isArray(rawValue)) {
    details.eventIds = "must be an array";
    return undefined;
  }
  const parsedIds = [];
  for (const candidateId of rawValue) {
    if (typeof candidateId !== "string" || !mongoose.Types.ObjectId.isValid(candidateId)) {
      details.eventIds = "every entry must be a valid ObjectId";
      return undefined;
    }
    parsedIds.push(new mongoose.Types.ObjectId(candidateId));
  }
  return parsedIds;
}

/* Event-first assign requires at least one event id. */
function parseRequiredEventIds(rawValue, details) {
  const parsed = parseEventIds(rawValue, details);
  if (parsed !== undefined && parsed.length === 0) {
    details.eventIds = "must name at least one event";
    return undefined;
  }
  return parsed;
}

/*
 * Volunteer checkpoint-type scoping. Absent or empty means unrestricted. Every
 * entry must be a known CHECKPOINT_TYPE.
 */
function parseAllowedCheckpointTypes(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }
  if (!Array.isArray(rawValue)) {
    details.allowedCheckpointTypes = "must be an array";
    return undefined;
  }
  for (const candidate of rawValue) {
    if (!ALLOWED_CHECKPOINT_TYPE_VALUES.includes(candidate)) {
      details.allowedCheckpointTypes = `every entry must be one of: ${ALLOWED_CHECKPOINT_TYPE_VALUES.join(", ")}`;
      return undefined;
    }
  }
  return rawValue;
}

/*
 * Optional role-specific contact phone. The user model deliberately validates a
 * phone as no more than a trimmed non-empty string (numbers vary too widely);
 * this mirrors that looseness with a light E.164-ish sanity check: an optional
 * leading +, then digits with spaces or dashes, 5–20 characters. Absent or blank
 * means "use their personal phoneNumber" and is stored as null.
 */
const CONTACT_PHONE_PATTERN = /^\+?[0-9][0-9 \-]{3,18}[0-9]$/;

function parseOptionalContactPhone(rawValue, fieldName, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string") {
    details[fieldName] = "must be a string";
    return undefined;
  }
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    return null;
  }
  if (!CONTACT_PHONE_PATTERN.test(trimmedValue)) {
    details[fieldName] = "must be a phone number (digits, spaces, dashes, optional leading +)";
    return undefined;
  }
  return trimmedValue;
}

/* An optional ISO window bound; absent stays undefined so the service derives it. */
function parseOptionalDate(rawValue, fieldName, details) {
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    details[fieldName] = "must be a valid ISO date";
    return undefined;
  }
  return parsed;
}

function validateAssignStaffPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const emailAddress = parseEmailAddress(requestBody.emailAddress, details);
  const role = parseRole(requestBody.role, details);
  const eventIds = parseEventIds(requestBody.eventIds, details);
  const assignmentContactPhone = parseOptionalContactPhone(
    requestBody.assignmentContactPhone,
    "assignmentContactPhone",
    details
  );

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value: { emailAddress, role, eventIds, assignmentContactPhone } };
}

/* Revoking takes an optional free-text reason and nothing else. */
function validateRevokeAssignmentPayload(requestBody) {
  const body = requestBody || {};
  if (typeof body !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const { reason } = body;
  if (reason === undefined || reason === null) {
    return { ok: true, value: { reason: null } };
  }
  if (typeof reason !== "string") {
    return buildValidationFailure({ reason: "must be a string" });
  }

  const trimmedReason = reason.trim();
  return { ok: true, value: { reason: trimmedReason.length === 0 ? null : trimmedReason } };
}

/*
 * Event-first: name the events, the person (by email), and the role in one call.
 *
 * MAIN GATE IS THE ONE EXCEPTION to "name at least one event". The gate belongs
 * to the whole fest and to no event — that is what makes it the common
 * checkpoint — so a gate assignment carries an EMPTY eventIds, which is the
 * existing encoding for "the whole fest" (see assignment-coverage-helpers). The
 * flag exists so that empty array is an explicit choice rather than something a
 * client can arrive at by forgetting to send events.
 */
function validateAssignToEventsPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const emailAddress = parseEmailAddress(requestBody.emailAddress, details);
  const role = parseRole(requestBody.role, details);
  const isMainGateAssignment = requestBody.mainGate === true;
  const eventIds = isMainGateAssignment
    ? parseEventIds(requestBody.eventIds, details) ?? []
    : parseRequiredEventIds(requestBody.eventIds, details);
  if (isMainGateAssignment && eventIds && eventIds.length > 0) {
    details.eventIds = "must be empty for a Main Gate assignment";
  }
  const validFrom = parseOptionalDate(requestBody.validFrom, "validFrom", details);
  const validTo = parseOptionalDate(requestBody.validTo, "validTo", details);
  const allowedCheckpointTypes = parseAllowedCheckpointTypes(
    requestBody.allowedCheckpointTypes,
    details
  );
  const assignmentContactPhone = parseOptionalContactPhone(
    requestBody.assignmentContactPhone,
    "assignmentContactPhone",
    details
  );

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      emailAddress,
      role,
      eventIds,
      validFrom,
      validTo,
      /*
       * A Main Gate assignment is ALWAYS type-locked to ['gate'], never to
       * whatever the client sent. An empty allowedCheckpointTypes means
       * "unrestricted" everywhere it is read, so accepting the client's value
       * here would let a gate assignment silently become an
       * everything-everywhere assignment — the opposite of what the admin
       * chose — by the client simply omitting the field.
       */
      allowedCheckpointTypes: isMainGateAssignment
        ? [CHECKPOINT_TYPES.GATE]
        : allowedCheckpointTypes,
      isMainGateAssignment,
      assignmentContactPhone,
    },
  };
}

module.exports = {
  validateAssignStaffPayload,
  validateAssignToEventsPayload,
  validateRevokeAssignmentPayload,
  ASSIGNABLE_ROLES,
};
