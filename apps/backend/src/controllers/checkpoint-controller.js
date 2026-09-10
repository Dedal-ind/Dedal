const checkpointService = require("../services/checkpoint-service");

async function getMyCheckpoints(request, response) {
  const { userId } = request.authenticatedUser;
  const checkpoints = await checkpointService.listMyActiveCheckpoints(userId);
  return response.status(200).json({ data: checkpoints });
}

async function getFestCheckpoints(request, response) {
  const checkpoints = await checkpointService.listFestCheckpoints(request.params.festId, {
    isAdministrator: Boolean(request.isAdministrator),
    assignment: request.staffAssignment,
  });
  return response.status(200).json({ data: { checkpoints } });
}

async function postCreateOfferCheckpoint(request, response) {
  const checkpoint = await checkpointService.createOfferCheckpoint(request.params.festId, {
    offerId: request.body?.offerId,
    checkpointName: request.body?.checkpointName,
  });
  return response.status(201).json({ data: checkpoint });
}

async function patchCheckpoint(request, response) {
  const checkpoint = await checkpointService.updateCheckpoint(
    request.params.festId,
    request.params.checkpointId,
    request.body ?? {}
  );
  return response.status(200).json({ data: checkpoint });
}

/* Admin-only: tell the volunteers on duty here that scanning has started. */
async function postAlertCheckpointVolunteers(request, response) {
  const { extractRequestContext } = require("../helpers/request-context");
  const result = await checkpointService.alertCheckpointVolunteers(
    request.params.festId,
    request.params.checkpointId,
    request.body?.message,
    request.authenticatedUser.userId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getMyCheckpoints,
  getFestCheckpoints,
  postCreateOfferCheckpoint,
  patchCheckpoint,
  postAlertCheckpointVolunteers,
};
