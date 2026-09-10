const participantSearchService = require("../services/participant-search-service");

async function getSearchParticipants(request, response) {
  const { userId } = request.authenticatedUser;
  const { query, festId, eventId } = request.query;
  const results = await participantSearchService.searchParticipants(userId, {
    query,
    festId,
    eventId,
  });
  return response.status(200).json({ data: results });
}

module.exports = { getSearchParticipants };
