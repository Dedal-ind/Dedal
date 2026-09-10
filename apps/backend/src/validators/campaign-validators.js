const mongoose = require("mongoose");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  PLACEMENT_KEYS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  TARGETING_DIMENSIONS,
} = require("../constants/campaign-constants");

/*
 * Shape checks for the campaign admin endpoints. Only shape and the
 * arithmetic that needs no database: flight end after start, weights at least
 * one, positive pacing and caps, a flight cap not below a day cap, a tier in
 * range, placement keys in the enum, and a targeting predicate that is an
 * object of include/exclude sets over the declared dimensions. Whether the
 * campaign may be edited in its current status, whether a creative belongs
 * to the promoter, whether a placement is active — those need the database
 * and are the service's.
 */

const NAME_MAX_LENGTH = 120;
const FLIGHT_FILTERS = ["live", "upcoming", "ended"];
const TIER_VALUES = Object.values(CAMPAIGN_PRIORITY_TIERS);

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

function parseObjectId(rawValue, fieldName, details, { required = false } = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (required) {
      details[fieldName] = "is required";
    }
    return undefined;
  }
  if (!mongoose.Types.ObjectId.isValid(rawValue)) {
    details[fieldName] = "must be a valid id";
    return undefined;
  }
  return String(rawValue);
}

function parseName(rawValue, details, { required = false } = {}) {
  if (rawValue === undefined) {
    if (required) {
      details.name = "is required";
    }
    return undefined;
  }
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    details.name = "is required";
    return undefined;
  }
  if (rawValue.trim().length > NAME_MAX_LENGTH) {
    details.name = `must be at most ${NAME_MAX_LENGTH} characters`;
    return undefined;
  }
  return rawValue.trim();
}

function parseDate(rawValue, fieldName, details, { required = false } = {}) {
  if (rawValue === undefined) {
    if (required) {
      details[fieldName] = "is required";
    }
    return undefined;
  }
  const date = new Date(rawValue);
  if (rawValue === null || Number.isNaN(date.getTime())) {
    details[fieldName] = "must be a date";
    return undefined;
  }
  return date;
}

function parsePositiveInteger(rawValue, fieldName, details, { minimum = 1 } = {}) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null) {
    return null;
  }
  const number = Number(rawValue);
  if (!Number.isInteger(number) || number < minimum) {
    details[fieldName] = `must be an integer of at least ${minimum}`;
    return undefined;
  }
  return number;
}

function parsePlacementKeys(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue)) {
    details.placementKeys = "must be an array of placement keys";
    return undefined;
  }
  const allowed = Object.values(PLACEMENT_KEYS);
  const unknown = rawValue.filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    details.placementKeys = `unknown placement: ${unknown.join(", ")}`;
    return undefined;
  }
  return [...new Set(rawValue)];
}

function parseTier(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  const number = Number(rawValue);
  if (!TIER_VALUES.includes(number)) {
    details.priorityTier = `must be one of ${TIER_VALUES.join(", ")}`;
    return undefined;
  }
  return number;
}

/* { totalImpressionTarget } — positive if present; null clears. */
function parsePacing(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null) {
    return { totalImpressionTarget: null };
  }
  if (typeof rawValue !== "object") {
    details.pacing = "must be an object";
    return undefined;
  }
  const target = parsePositiveInteger(rawValue.totalImpressionTarget, "pacing.totalImpressionTarget", details);
  return { totalImpressionTarget: target === undefined ? null : target };
}

/* { maxPerDay, maxPerFlight } — positive if present, and a flight cap never
   below a day cap: a day allowance the flight could not honour is unsatisfiable. */
function parseFrequencyCap(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null) {
    return { maxPerDay: null, maxPerFlight: null };
  }
  if (typeof rawValue !== "object") {
    details.frequencyCap = "must be an object";
    return undefined;
  }
  const maxPerDay = parsePositiveInteger(rawValue.maxPerDay, "frequencyCap.maxPerDay", details);
  const maxPerFlight = parsePositiveInteger(rawValue.maxPerFlight, "frequencyCap.maxPerFlight", details);
  const cap = {
    maxPerDay: maxPerDay === undefined ? null : maxPerDay,
    maxPerFlight: maxPerFlight === undefined ? null : maxPerFlight,
  };
  if (cap.maxPerDay !== null && cap.maxPerFlight !== null && cap.maxPerFlight < cap.maxPerDay) {
    details["frequencyCap.maxPerFlight"] = "must not be lower than maxPerDay";
    return undefined;
  }
  return cap;
}

/*
 * Shape only: an object whose include/exclude halves are objects whose keys
 * are declared dimensions and whose values are arrays. Stored as given; the
 * model's strict subschema is the backstop and the editor is a later prompt.
 */
function parseTargeting(rawValue, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null) {
    return {};
  }
  if (typeof rawValue !== "object" || Array.isArray(rawValue)) {
    details.targeting = "must be an object with include and exclude sets";
    return undefined;
  }
  const result = {};
  for (const half of Object.keys(rawValue)) {
    if (half !== "include" && half !== "exclude") {
      details.targeting = `unknown key "${half}"; only include and exclude are allowed`;
      return undefined;
    }
    const set = rawValue[half];
    if (set === null || set === undefined) {
      continue;
    }
    if (typeof set !== "object" || Array.isArray(set)) {
      details[`targeting.${half}`] = "must be an object of dimension arrays";
      return undefined;
    }
    result[half] = {};
    for (const dimension of Object.keys(set)) {
      if (!TARGETING_DIMENSIONS.includes(dimension)) {
        details[`targeting.${half}`] = `unknown dimension "${dimension}"; allowed: ${TARGETING_DIMENSIONS.join(", ")}`;
        return undefined;
      }
      if (!Array.isArray(set[dimension])) {
        details[`targeting.${half}.${dimension}`] = "must be an array";
        return undefined;
      }
      result[half][dimension] = set[dimension];
    }
  }
  return result;
}

function collectCampaignFields(requestBody, details, { isCreate }) {
  const value = {
    name: parseName(requestBody.name, details, { required: isCreate }),
    flightStartsAt: parseDate(requestBody.flightStartsAt, "flightStartsAt", details, { required: isCreate }),
    flightEndsAt: parseDate(requestBody.flightEndsAt, "flightEndsAt", details, { required: isCreate }),
    placementKeys: parsePlacementKeys(requestBody.placementKeys, details),
    priorityTier: parseTier(requestBody.priorityTier, details),
    weight: parsePositiveInteger(requestBody.weight, "weight", details),
    pacing: parsePacing(requestBody.pacing, details),
    frequencyCap: parseFrequencyCap(requestBody.frequencyCap, details),
    targeting: parseTargeting(requestBody.targeting, details),
    displayOrder: parsePositiveInteger(requestBody.displayOrder, "displayOrder", details, { minimum: 0 }),
  };
  if (value.weight === null) {
    details.weight = "must be an integer of at least 1";
  }
  if (value.priorityTier === null) {
    details.priorityTier = `must be one of ${TIER_VALUES.join(", ")}`;
  }
  if (
    value.flightStartsAt instanceof Date &&
    value.flightEndsAt instanceof Date &&
    value.flightEndsAt.getTime() <= value.flightStartsAt.getTime()
  ) {
    details.flightEndsAt = "must be after flightStartsAt";
  }
  return value;
}

function validateCreateCampaignPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const promoterId = parseObjectId(requestBody.promoterId, "promoterId", details, { required: true });
  const value = { promoterId, ...collectCampaignFields(requestBody, details, { isCreate: true }) };
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateUpdateCampaignPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const promoterId = parseObjectId(requestBody.promoterId, "promoterId", details);
  const fields = collectCampaignFields(requestBody, details, { isCreate: false });
  const value = {};
  if (promoterId !== undefined) {
    value.promoterId = promoterId;
  }
  for (const [field, parsed] of Object.entries(fields)) {
    if (parsed !== undefined) {
      value[field] = parsed;
    }
  }
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateListCampaignsQuery(query) {
  const details = {};
  const value = {
    promoterId: parseObjectId(query.promoterId, "promoterId", details),
    status: undefined,
    placementKey: undefined,
    flight: undefined,
    page: query.page === undefined ? undefined : Number(query.page),
    limit: query.limit === undefined ? undefined : Number(query.limit),
  };
  if (query.status !== undefined) {
    if (!Object.values(CAMPAIGN_STATUSES).includes(query.status)) {
      details.status = `must be one of ${Object.values(CAMPAIGN_STATUSES).join(", ")}`;
    } else {
      value.status = query.status;
    }
  }
  if (query.placementKey !== undefined) {
    if (!Object.values(PLACEMENT_KEYS).includes(query.placementKey)) {
      details.placementKey = `must be one of ${Object.values(PLACEMENT_KEYS).join(", ")}`;
    } else {
      value.placementKey = query.placementKey;
    }
  }
  if (query.flight !== undefined) {
    if (!FLIGHT_FILTERS.includes(query.flight)) {
      details.flight = `must be one of ${FLIGHT_FILTERS.join(", ")}`;
    } else {
      value.flight = query.flight;
    }
  }
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateAttachCreativePayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {
    creativeId: parseObjectId(requestBody.creativeId, "creativeId", details, { required: true }),
    rotationWeight: parsePositiveInteger(requestBody.rotationWeight, "rotationWeight", details) ?? 1,
    isActive: requestBody.isActive === undefined ? true : requestBody.isActive === true,
  };
  if (value.rotationWeight === null) {
    details.rotationWeight = "must be an integer of at least 1";
  }
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateUpdateAssociationPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {};
  const rotationWeight = parsePositiveInteger(requestBody.rotationWeight, "rotationWeight", details);
  if (rotationWeight === null) {
    details.rotationWeight = "must be an integer of at least 1";
  } else if (rotationWeight !== undefined) {
    value.rotationWeight = rotationWeight;
  }
  if (requestBody.isActive !== undefined) {
    if (typeof requestBody.isActive !== "boolean") {
      details.isActive = "must be true or false";
    } else {
      value.isActive = requestBody.isActive;
    }
  }
  if (Object.keys(value).length === 0 && Object.keys(details).length === 0) {
    details.body = "nothing to change: send rotationWeight and/or isActive";
  }
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

module.exports = {
  validateCreateCampaignPayload,
  validateUpdateCampaignPayload,
  validateListCampaignsQuery,
  validateAttachCreativePayload,
  validateUpdateAssociationPayload,
  FLIGHT_FILTERS,
};
