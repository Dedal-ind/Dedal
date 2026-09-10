const festService = require("../services/fest-service");
const festCancellationService = require("../services/fest-cancellation-service");
// PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
const festPurgeService = require("../services/fest-purge-service");
const staffDirectoryService = require("../services/staff-directory-service");
const participantDirectoryService = require("../services/participant-directory-service");
const {
  validateCreateFestPayload,
  validateUpdateFestPayload,
} = require("../validators/fest-validators");
const { extractRequestContext } = require("../helpers/request-context");

async function postCreateFest(request, response) {
  const validation = validateCreateFestPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const fest = await festService.createFest(userId, validation.value, extractRequestContext(request));
  return response.status(201).json({ data: fest });
}

async function getMyFests(request, response) {
  const { userId } = request.authenticatedUser;
  const fests = await festService.fetchFestsForAdministrator(userId);
  return response.status(200).json({ data: fests });
}

async function getFestById(request, response) {
  const { userId } = request.authenticatedUser;
  const fest = await festService.fetchFestById(userId, request.params.festId);
  return response.status(200).json({ data: fest });
}

async function patchUpdateFest(request, response) {
  const validation = validateUpdateFestPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const fest = await festService.updateFest(
    userId,
    request.params.festId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: fest });
}

/*
 * Cancelling a fest is irreversible and notifies everyone, so the console shows
 * these counts BEFORE the confirm. Separate GET, never a flag on the POST.
 */
async function getCancelFestPreview(request, response) {
  const { userId } = request.authenticatedUser;
  const preview = await festCancellationService.previewCancelFest(userId, request.params.festId);
  return response.status(200).json({ data: preview });
}

async function postCancelFest(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await festCancellationService.cancelFest(
    userId,
    request.params.festId,
    request.body?.reason,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/* PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL. */
async function getPurgeFestPreview(request, response) {
  const { userId } = request.authenticatedUser;
  const preview = await festPurgeService.previewPurgeFest(userId, request.params.festId);
  return response.status(200).json({ data: preview });
}

/* PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL. */
async function deletePurgeFest(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await festPurgeService.purgeFest(
    userId,
    request.params.festId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}


/*
 * Hard fest delete — zero-registration fests only (test/duplicate fests).
 * Anything with real sign-ups is cancelled or archived instead; the service 409s.
 * Production-safe, unlike /purge which is env-gated dev tooling.
 */
async function deleteFestHandler(request, response) {
  const { userId } = request.authenticatedUser;
  const { deleteFest } = require("../services/event-service");
  const result = await deleteFest(userId, request.params.festId, extractRequestContext(request));
  return response.status(200).json({ data: result });
}

async function postArchiveFest(request, response) {
  const { userId } = request.authenticatedUser;
  const fest = await festService.archiveFest(userId, request.params.festId, extractRequestContext(request));
  return response.status(200).json({ data: fest });
}

async function postPublishFest(request, response) {
  const { userId } = request.authenticatedUser;
  const fest = await festService.publishFest(userId, request.params.festId, extractRequestContext(request));
  return response.status(200).json({ data: fest });
}

async function postUnarchiveFest(request, response) {
  const { userId } = request.authenticatedUser;
  const fest = await festService.unarchiveFest(
    userId,
    request.params.festId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: fest });
}

async function getFestParticipants(request, response) {
  const { userId } = request.authenticatedUser;
  const participants = await participantDirectoryService.listFestParticipants(
    userId,
    request.params.festId
  );
  return response.status(200).json({ data: participants });
}

async function getStaffDirectory(request, response) {
  const { userId } = request.authenticatedUser;
  const directory = await staffDirectoryService.getStaffDirectory(
    userId,
    request.params.festId,
    request.query.eventId
  );
  return response.status(200).json({ data: directory });
}

module.exports = {
  deleteFestHandler,
  postCreateFest,
  getMyFests,
  getFestById,
  patchUpdateFest,
  postArchiveFest,
  postCancelFest,
  getCancelFestPreview,
  // PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
  getPurgeFestPreview,
  deletePurgeFest,
  postPublishFest,
  postUnarchiveFest,
  getFestParticipants,
  getStaffDirectory,
};
