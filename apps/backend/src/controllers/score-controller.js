const scoreService = require("../services/score-service");
const { extractRequestContext } = require("../helpers/request-context");

async function getLeaderboard(request, response) {
  const leaderboard = await scoreService.getLeaderboard(request.params.eventId);
  return response.status(200).json({ data: leaderboard });
}

async function postInitializeScores(request, response) {
  const result = await scoreService.initializeScores(request.params.eventId);
  return response.status(200).json({ data: result });
}

async function patchScore(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await scoreService.updateScore({
    eventId: request.params.eventId,
    registrationId: request.params.registrationId,
    newScore: request.body?.score,
    expectedVersion: request.body?.expectedVersion,
    actorUserId: userId,
    isAdministrator: Boolean(request.isAdministrator),
    festId: request.params.festId,
    context: extractRequestContext(request),
  });
  return response.status(200).json({ data: result });
}

async function postFinalizeScores(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await scoreService.finalizeScores({
    eventId: request.params.eventId,
    actorUserId: userId,
    festId: request.params.festId,
    context: extractRequestContext(request),
  });
  return response.status(200).json({ data: result });
}

async function getScore(request, response) {
  const scoreRow = await scoreService.getScoreForRegistration(
    request.params.eventId,
    request.params.registrationId
  );
  return response.status(200).json({ data: scoreRow });
}

module.exports = {
  getLeaderboard,
  postInitializeScores,
  patchScore,
  postFinalizeScores,
  getScore,
};
