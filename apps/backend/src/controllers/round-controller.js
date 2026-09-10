const multer = require("multer");

const roundService = require("../services/round-service");
const { getStorageDriver, ALLOWED_DOCUMENT_MIME_TYPES } = require("../services/upload-storage-service");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * 50MB: a coordinator's round deck is a PPT with slides in it, not a banner.
 * Enforced by multer BEFORE the body is buffered, so an oversized upload is
 * refused at the edge rather than after the process has held it in memory.
 */
const MAX_ROUND_DOCUMENT_BYTES = 50 * 1024 * 1024;

const roundDocumentUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ROUND_DOCUMENT_BYTES },
}).single("file");

async function postCreateRound(request, response) {
  const round = await roundService.createRound(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(201).json({ data: round });
}

async function getListRounds(request, response) {
  const result = await roundService.listRounds(request.params.eventId);
  return response.status(200).json({ data: result });
}

async function getRoundDetail(request, response) {
  const result = await roundService.getRoundDetail(request.params.eventId, request.params.roundId);
  return response.status(200).json({ data: result });
}

async function patchRound(request, response) {
  const round = await roundService.updateRound(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: round });
}

async function postAdvanceParticipants(request, response) {
  const round = await roundService.advanceParticipants(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    request.body?.participantUserIds,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: round });
}

async function postRetractParticipants(request, response) {
  const round = await roundService.retractParticipants(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    request.body?.participantUserIds,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: round });
}

async function postRoundScores(request, response) {
  const entries = Array.isArray(request.body) ? request.body : request.body?.scores;
  const result = await roundService.saveRoundScores(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    entries,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * The admin result board's single read: rounds as columns, participants as
 * rows. Coordinator-or-admin like every other round read — a coordinator
 * looking at their own event's board is reading their own sheet.
 */
async function getRoundScoreboard(request, response) {
  const scoreboard = await roundService.getRoundScoreboard(request.params.eventId);
  return response.status(200).json({ data: scoreboard });
}

/*
 * One cell, corrected by an administrator. Admin-only at the route: this is the
 * path that deliberately bypasses the coordinator's presence gate and the
 * finalise lock, so it must not be reachable by a coordinator.
 */
async function patchRoundScoreAsAdministrator(request, response) {
  const scoreboard = await roundService.setRoundScoreAsAdministrator(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    request.params.participantUserId,
    request.body?.score,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: scoreboard });
}

async function postRoundDocument(request, response) {
  if (!request.file) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "No file was uploaded.", {
      file: "is required",
    });
  }
  // assertDocument inside the driver refuses anything outside the whitelist with
  // FILE_TYPE_NOT_ALLOWED before a byte is written to storage.
  const stored = await getStorageDriver().upload(request.file.buffer, request.file.mimetype, {
    kind: "document",
    allowedMimeTypes: ALLOWED_DOCUMENT_MIME_TYPES,
  });
  const round = await roundService.attachRoundDocument(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    {
      url: stored.url,
      fileName: request.file.originalname ?? null,
      mimeType: request.file.mimetype,
    },
    extractRequestContext(request)
  );
  return response.status(200).json({ data: round });
}

async function getEventOverviewStats(request, response) {
  const stats = await roundService.getEventOverviewStats(request.params.eventId);
  return response.status(200).json({ data: stats });
}

async function postStartRound(request, response) {
  const result = await roundService.startRound(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postFinaliseResults(request, response) {
  const result = await roundService.finaliseResults(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.body?.winners ?? [],
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postDeleteRounds(request, response) {
  const result = await roundService.deleteRounds(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.body?.roundIds ?? [],
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postEliminateParticipants(request, response) {
  const result = await roundService.eliminateParticipants(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.params.roundId,
    {
      advancingUserIds: request.body?.advancingUserIds ?? [],
      eliminatedUserIds: request.body?.eliminatedUserIds ?? [],
      /* { [participantUserId]: "A" } — optional group split for the round being
         advanced into. Shape-checked in the service, which owns team expansion. */
      lots: request.body?.lots ?? null,
    },
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postAwardRoundResults(request, response) {
  const result = await roundService.awardRoundResults(
    request.authenticatedUser.userId,
    request.params.eventId,
    extractRequestContext(request),
    /* Optional [{ userId, placement }] — a coordinator's override of the
     * score-derived ranking. Absent means "rank by score". */
    request.body?.winners ?? null
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  postCreateRound,
  postStartRound,
  getListRounds,
  getRoundDetail,
  patchRound,
  postDeleteRounds,
  postAdvanceParticipants,
  postEliminateParticipants,
  postAwardRoundResults,
  postFinaliseResults,
  postRetractParticipants,
  postRoundScores,
  getRoundScoreboard,
  patchRoundScoreAsAdministrator,
  postRoundDocument,
  roundDocumentUploadMiddleware,
  getEventOverviewStats,
};
