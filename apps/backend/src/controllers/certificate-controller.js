const mongoose = require("mongoose");

const certificateService = require("../services/certificate-service");
const { extractRequestContext } = require("../helpers/request-context");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The optional eventIds array on generate/release. Shape-only here; whether a
 * coordinator actually covers those events is the service's scope resolution.
 */
function parseRequestedEventIds(requestBody, response) {
  const rawEventIds = requestBody?.eventIds;
  if (rawEventIds === undefined) {
    return { ok: true, value: null };
  }
  if (
    !Array.isArray(rawEventIds) ||
    rawEventIds.some((id) => typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id))
  ) {
    response.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more fields are invalid.",
        details: { eventIds: "must be an array of valid ObjectIds" },
      },
    });
    return { ok: false };
  }
  return { ok: true, value: rawEventIds };
}

// The coordinator/admin gate ran before this and stamped isAdministrator + the
// covering staffAssignment; the service resolves the actual event scope from them.
function buildCertificateScope(request, requestedEventIds) {
  return {
    isAdministrator: Boolean(request.isAdministrator),
    staffAssignment: request.staffAssignment,
    requestedEventIds,
  };
}

/*
 * Optional participant subset for the admin push (shape-only ObjectIds; the
 * service applies them inside the caller's already-resolved event scope, so a
 * selection can never widen authority).
 */
function parseRequestedUserIds(requestBody, response) {
  const rawValue = requestBody?.userIds;
  if (rawValue === undefined || rawValue === null) {
    return { ok: true, value: null };
  }
  if (
    !Array.isArray(rawValue) ||
    rawValue.some((candidateId) => typeof candidateId !== "string" || !mongoose.Types.ObjectId.isValid(candidateId))
  ) {
    response.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "One or more fields are invalid.",
        details: { userIds: "must be an array of valid user ids" },
      },
    });
    return { ok: false };
  }
  return { ok: true, value: rawValue };
}

async function postGenerateCertificates(request, response) {
  const { userId } = request.authenticatedUser;
  const parsedEventIds = parseRequestedEventIds(request.body, response);
  if (!parsedEventIds.ok) return undefined;
  const parsedUserIds = parseRequestedUserIds(request.body, response);
  if (!parsedUserIds.ok) return undefined;
  const result = await certificateService.generateCertificatesForFest(
    userId,
    request.params.festId,
    extractRequestContext(request),
    buildCertificateScope(request, parsedEventIds.value),
    parsedUserIds.value
  );
  return response.status(200).json({ data: result });
}

async function postReleaseCertificates(request, response) {
  const { userId } = request.authenticatedUser;
  const parsedEventIds = parseRequestedEventIds(request.body, response);
  if (!parsedEventIds.ok) return undefined;
  const parsedUserIds = parseRequestedUserIds(request.body, response);
  if (!parsedUserIds.ok) return undefined;
  const result = await certificateService.releaseCertificatesForFest(
    userId,
    request.params.festId,
    extractRequestContext(request),
    buildCertificateScope(request, parsedEventIds.value),
    parsedUserIds.value
  );
  return response.status(200).json({ data: result });
}

/* A sample PDF for template alignment — administrator-only, like the template. */
async function postPreviewCertificate(request, response) {
  const { userId } = request.authenticatedUser;
  const buffer = await certificateService.previewCertificatePdf(userId, request.params.festId);
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", 'inline; filename="certificate-preview.pdf"');
  return response.status(200).send(buffer);
}

async function getMyCertificates(request, response) {
  const { userId } = request.authenticatedUser;
  const certificates = await certificateService.listMyCertificates(userId);
  return response.status(200).json({ data: certificates });
}

async function getMyCertificatePdf(request, response) {
  const { userId } = request.authenticatedUser;
  const { buffer, fileName } = await certificateService.generateCertificatePdf(
    request.params.certificateId,
    userId
  );
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return response.status(200).send(buffer);
}

/* Public — no authentication. A recruiter verifies a code with no account. */
async function getVerifyCertificate(request, response) {
  const certificate = await certificateService.getCertificateByVerificationCode(
    request.params.verificationCode
  );
  return response.status(200).json({ data: certificate });
}

module.exports = {
  postGenerateCertificates,
  postReleaseCertificates,
  postPreviewCertificate,
  getMyCertificates,
  getMyCertificatePdf,
  getVerifyCertificate,
};
