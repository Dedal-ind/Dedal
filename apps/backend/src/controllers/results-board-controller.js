const resultsBoardService = require("../services/results-board-service");
const certificatePushService = require("../services/certificate-push-service");
const { extractRequestContext } = require("../helpers/request-context");

async function getResultsBoard(request, response) {
  const result = await resultsBoardService.getResultsBoard(request.params.festId);
  return response.status(200).json({ data: result });
}

async function postPushWinnerCertificates(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await certificatePushService.pushWinnerCertificates(
    userId,
    request.params.festId,
    request.params.eventId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postPushParticipationCertificates(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await certificatePushService.pushParticipationCertificates(
    userId,
    request.params.festId,
    request.params.eventId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getResultsBoard,
  postPushWinnerCertificates,
  postPushParticipationCertificates,
};
