const mongoose = require("mongoose");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  PROMOTER_KINDS,
  PROMOTER_STATUSES,
  CREATIVE_MEDIA_TYPES,
  CREATIVE_STATUSES,
} = require("../constants/campaign-constants");

/*
 * Shape checks for the promoter and creative admin endpoints. Only shape —
 * whether an id looks like an id, a kind is a kind, a string fits its cap.
 * Whether a name collides, a creative is in a published campaign, or a
 * promoter is archived is the service's call, because those need the
 * database.
 */

const DISPLAY_NAME_MAX_LENGTH = 120;
const CONTACT_NAME_MAX_LENGTH = 120;
const CONTACT_EMAIL_MAX_LENGTH = 254;
const CONTACT_PHONE_MAX_LENGTH = 32;
const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 300;
const URL_MAX_LENGTH = 2048;

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

/* undefined = absent (leave as is), null/"" = explicit clear, else a trimmed string. */
function parseOptionalString(rawValue, fieldName, maxLength, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  if (typeof rawValue !== "string") {
    details[fieldName] = "must be a string";
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length > maxLength) {
    details[fieldName] = `must be at most ${maxLength} characters`;
    return undefined;
  }
  return trimmed.length === 0 ? null : trimmed;
}

function parseRequiredString(rawValue, fieldName, maxLength, details) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    details[fieldName] = "is required";
    return undefined;
  }
  if (rawValue.trim().length > maxLength) {
    details[fieldName] = `must be at most ${maxLength} characters`;
    return undefined;
  }
  return rawValue.trim();
}

function parseEnum(rawValue, fieldName, allowed, details, { required = false } = {}) {
  if (rawValue === undefined) {
    if (required) {
      details[fieldName] = `is required; one of ${allowed.join(", ")}`;
    }
    return undefined;
  }
  if (!allowed.includes(rawValue)) {
    details[fieldName] = `must be one of ${allowed.join(", ")}`;
    return undefined;
  }
  return rawValue;
}

function parseOptionalObjectId(rawValue, fieldName, details) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (rawValue === null || rawValue === "") {
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(rawValue)) {
    details[fieldName] = "must be a valid id or null";
    return undefined;
  }
  return String(rawValue);
}

function parseOptionalUrl(rawValue, fieldName, details) {
  const value = parseOptionalString(rawValue, fieldName, URL_MAX_LENGTH, details);
  if (value === undefined || value === null) {
    return value;
  }
  if (!/^https?:\/\//i.test(value)) {
    details[fieldName] = "must be an http(s) URL";
    return undefined;
  }
  return value;
}

function parseEmail(rawValue, fieldName, details) {
  const value = parseOptionalString(rawValue, fieldName, CONTACT_EMAIL_MAX_LENGTH, details);
  if (value === undefined || value === null) {
    return value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    details[fieldName] = "must be a valid email address";
    return undefined;
  }
  return value.toLowerCase();
}

/* ------------------------------------------------------------- promoters */

function validateCreatePromoterPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {
    displayName: parseRequiredString(requestBody.displayName, "displayName", DISPLAY_NAME_MAX_LENGTH, details),
    kind: parseEnum(requestBody.kind, "kind", Object.values(PROMOTER_KINDS), details, { required: true }),
    contactName: parseOptionalString(requestBody.contactName, "contactName", CONTACT_NAME_MAX_LENGTH, details),
    contactEmail: parseEmail(requestBody.contactEmail, "contactEmail", details),
    contactPhone: parseOptionalString(requestBody.contactPhone, "contactPhone", CONTACT_PHONE_MAX_LENGTH, details),
    collegeId: parseOptionalObjectId(requestBody.collegeId, "collegeId", details),
  };
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

/* Every field optional; only present ones are applied. Status is NOT here —
   archive and restore are their own endpoints. */
function validateUpdatePromoterPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {};
  if (requestBody.displayName !== undefined) {
    value.displayName = parseRequiredString(requestBody.displayName, "displayName", DISPLAY_NAME_MAX_LENGTH, details);
  }
  if (requestBody.kind !== undefined) {
    value.kind = parseEnum(requestBody.kind, "kind", Object.values(PROMOTER_KINDS), details);
  }
  value.contactName = parseOptionalString(requestBody.contactName, "contactName", CONTACT_NAME_MAX_LENGTH, details);
  value.contactEmail = parseEmail(requestBody.contactEmail, "contactEmail", details);
  value.contactPhone = parseOptionalString(requestBody.contactPhone, "contactPhone", CONTACT_PHONE_MAX_LENGTH, details);
  value.collegeId = parseOptionalObjectId(requestBody.collegeId, "collegeId", details);
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateListPromotersQuery(query) {
  const details = {};
  const value = {
    search: typeof query.search === "string" ? query.search.trim().slice(0, DISPLAY_NAME_MAX_LENGTH) : "",
    kind: parseEnum(query.kind, "kind", Object.values(PROMOTER_KINDS), details),
    status: parseEnum(query.status, "status", Object.values(PROMOTER_STATUSES), details),
    page: query.page === undefined ? undefined : Number(query.page),
    limit: query.limit === undefined ? undefined : Number(query.limit),
  };
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------- creatives */

/* The declared medium must match what was supplied — the promotion model's
   own rule, checked here too so the 400 names the field. */
/*
 * `isNew` is REQUIRED, not defaulted, and it governs the poster rule only.
 *
 * imageUrl doubles as a video's poster frame: it is what the feed shows before
 * playback, what a slow connection gets instead of autoplay, and what the pass
 * screen shows in place of a video it deliberately will not play. So a new
 * video creative must carry one.
 *
 * But requiring it unconditionally makes every video creative ALREADY saved
 * without a poster fail its next save - including an admin merely renaming it.
 * creative-model.js guards its own copy of this rule with `this.isNew` for
 * exactly that reason and says so; this function was checking it
 * unconditionally and is reached on the update path too (promoter-service's
 * assertDeclaredMedia runs on the merged row before save), which quietly
 * reversed that promise and made legacy video creatives uneditable.
 *
 * No default value: a caller that has not thought about which case it is in
 * should not silently get the stricter one and start rejecting edits.
 */
function checkDeclaredMedia(mediaType, imageUrl, videoUrl, details, isNew) {
  if (mediaType === CREATIVE_MEDIA_TYPES.VIDEO && !videoUrl) {
    details.videoUrl = "is required for a video creative";
  }
  if (isNew && mediaType === CREATIVE_MEDIA_TYPES.VIDEO && !imageUrl) {
    details.imageUrl = "a poster image is required for a video creative";
  }
  if (mediaType === CREATIVE_MEDIA_TYPES.IMAGE && !imageUrl) {
    details.imageUrl = "is required for an image creative";
  }
  if (mediaType === CREATIVE_MEDIA_TYPES.IMAGE && videoUrl) {
    details.videoUrl = "must be empty for an image creative";
  }
}

function validateCreateCreativePayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const promoterId = parseOptionalObjectId(requestBody.promoterId, "promoterId", details);
  if (promoterId === null || promoterId === undefined) {
    details.promoterId = details.promoterId ?? "is required";
  }
  const value = {
    promoterId,
    title: parseRequiredString(requestBody.title, "title", TITLE_MAX_LENGTH, details),
    mediaType:
      parseEnum(requestBody.mediaType, "mediaType", Object.values(CREATIVE_MEDIA_TYPES), details) ??
      CREATIVE_MEDIA_TYPES.IMAGE,
    imageUrl: parseOptionalUrl(requestBody.imageUrl, "imageUrl", details) ?? null,
    videoUrl: parseOptionalUrl(requestBody.videoUrl, "videoUrl", details) ?? null,
    linkUrl: parseOptionalUrl(requestBody.linkUrl, "linkUrl", details) ?? null,
    description: parseOptionalString(requestBody.description, "description", DESCRIPTION_MAX_LENGTH, details) ?? null,
  };
  if (!details.mediaType && !details.imageUrl && !details.videoUrl) {
    checkDeclaredMedia(value.mediaType, value.imageUrl, value.videoUrl, details, true);
  }
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

/* Partial: the media rule is re-checked by the service against the merged row. */
function validateUpdateCreativePayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const value = {};
  if (requestBody.title !== undefined) {
    value.title = parseRequiredString(requestBody.title, "title", TITLE_MAX_LENGTH, details);
  }
  if (requestBody.mediaType !== undefined) {
    value.mediaType = parseEnum(requestBody.mediaType, "mediaType", Object.values(CREATIVE_MEDIA_TYPES), details);
  }
  value.imageUrl = parseOptionalUrl(requestBody.imageUrl, "imageUrl", details);
  value.videoUrl = parseOptionalUrl(requestBody.videoUrl, "videoUrl", details);
  value.linkUrl = parseOptionalUrl(requestBody.linkUrl, "linkUrl", details);
  value.description = parseOptionalString(requestBody.description, "description", DESCRIPTION_MAX_LENGTH, details);
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateListCreativesQuery(query) {
  const details = {};
  const promoterId = parseOptionalObjectId(query.promoterId, "promoterId", details);
  if (!promoterId) {
    details.promoterId = details.promoterId ?? "is required";
  }
  let inUse;
  if (query.inUse !== undefined) {
    if (query.inUse === "true" || query.inUse === true) {
      inUse = true;
    } else if (query.inUse === "false" || query.inUse === false) {
      inUse = false;
    } else {
      details.inUse = "must be true or false";
    }
  }
  const value = {
    promoterId,
    mediaType: parseEnum(query.mediaType, "mediaType", Object.values(CREATIVE_MEDIA_TYPES), details),
    status: parseEnum(query.status, "status", Object.values(CREATIVE_STATUSES), details),
    inUse,
    page: query.page === undefined ? undefined : Number(query.page),
    limit: query.limit === undefined ? undefined : Number(query.limit),
  };
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

module.exports = {
  validateCreatePromoterPayload,
  validateUpdatePromoterPayload,
  validateListPromotersQuery,
  validateCreateCreativePayload,
  validateUpdateCreativePayload,
  validateListCreativesQuery,
  checkDeclaredMedia,
};
