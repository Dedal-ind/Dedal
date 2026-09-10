const mongoose = require("mongoose");

const { ERROR_CODES } = require("../constants/error-codes");
const { QR_TOKEN_LENGTH, BACKUP_CODE_PATTERN } = require("../constants/pass-constants");
const { SCAN_DIRECTIONS } = require("../constants/scan-constants");

const CLIENT_SCAN_ID_MIN = 8;
const CLIENT_SCAN_ID_MAX = 40;
const DEVICE_INFO_MAX = 200;

function buildValidationFailure(details) {
  return {
    ok: false,
    error: { code: ERROR_CODES.VALIDATION_FAILED, message: "One or more fields are invalid.", details },
  };
}

function parseCheckpointId(rawValue, details) {
  if (typeof rawValue !== "string" || !mongoose.Types.ObjectId.isValid(rawValue)) {
    details.checkpointId = "must be a valid ObjectId";
    return undefined;
  }
  return rawValue;
}

function parseClientScanId(rawValue, details) {
  if (typeof rawValue !== "string") {
    details.clientScanId = "is required";
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length < CLIENT_SCAN_ID_MIN || trimmed.length > CLIENT_SCAN_ID_MAX) {
    details.clientScanId = `must be between ${CLIENT_SCAN_ID_MIN} and ${CLIENT_SCAN_ID_MAX} characters`;
    return undefined;
  }
  return trimmed;
}

function parseDirection(rawValue, details) {
  if (!Object.values(SCAN_DIRECTIONS).includes(rawValue)) {
    details.direction = "must be 'in' or 'out'";
    return undefined;
  }
  return rawValue;
}

function parseScannedAt(rawValue, details) {
  const parsed = typeof rawValue === "string" ? new Date(rawValue) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) {
    details.scannedAt = "must be an ISO 8601 date";
    return undefined;
  }
  return parsed;
}

function parseDeviceInfo(rawValue, details) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string" || rawValue.length > DEVICE_INFO_MAX) {
    details.deviceInfo = `must be a string of at most ${DEVICE_INFO_MAX} characters`;
    return undefined;
  }
  return rawValue;
}

/* The fields both scan methods share; each method adds its own secret on top. */
function parseCommonFields(requestBody, details) {
  return {
    checkpointId: parseCheckpointId(requestBody.checkpointId, details),
    clientScanId: parseClientScanId(requestBody.clientScanId, details),
    direction: parseDirection(requestBody.direction, details),
    scannedAt: parseScannedAt(requestBody.scannedAt, details),
    deviceInfo: parseDeviceInfo(requestBody.deviceInfo, details),
  };
}

function finalise(value, details) {
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return { ok: true, value };
}

function validateQrScanPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const common = parseCommonFields(requestBody, details);
  const { qrToken } = requestBody;
  if (typeof qrToken !== "string" || qrToken.length !== QR_TOKEN_LENGTH) {
    details.qrToken = `must be a ${QR_TOKEN_LENGTH}-character string`;
  }
  return finalise({ ...common, qrToken }, details);
}

function validateBackupCodeScanPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const common = parseCommonFields(requestBody, details);
  const { backupCode } = requestBody;
  if (typeof backupCode !== "string" || !BACKUP_CODE_PATTERN.test(backupCode)) {
    details.backupCode = "must be a 6-digit numeric string";
  }
  return finalise({ ...common, backupCode }, details);
}

function validatePassScanPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }
  const details = {};
  const common = parseCommonFields(requestBody, details);
  const { passId } = requestBody;
  if (typeof passId !== "string" || !mongoose.Types.ObjectId.isValid(passId)) {
    details.passId = "must be a valid ObjectId";
  }
  return finalise({ ...common, passId }, details);
}

module.exports = {
  validateQrScanPayload,
  validateBackupCodeScanPayload,
  validatePassScanPayload,
};
