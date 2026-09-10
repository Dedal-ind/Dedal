const gateAccessService = require("../services/gate-access-service");
const offerStatsService = require("../services/offer-stats-service");

/*
 * The campus-access reads. Three audiences, three gates, all mounted elsewhere:
 *
 *   · the PARTICIPANT asks about their own pass (authentication only — the
 *     service refuses a pass the caller does not own, so ownership is checked
 *     against the data rather than assumed from the route);
 *   · the ADMIN asks about a fest (requireAdministratorMiddleware on the route);
 *   · the STAFF ON THE GATE ask what today looks like from where they stand
 *     (coordinator-or-admin on the route).
 */

async function getMyPassGateStatus(request, response) {
  const { userId } = request.authenticatedUser;
  const status = await gateAccessService.getPassGateStatus(userId, request.params.passId);
  return response.status(200).json({ data: status });
}

async function getFestGateStats(request, response) {
  // An absent or malformed ?date= falls back to today in the fest's timezone;
  // see fest-day-helpers.isValidFestDayKey for why it is validated rather than
  // passed straight through.
  const stats = await gateAccessService.getFestGateStats(
    request.params.festId,
    request.query?.date
  );
  return response.status(200).json({ data: stats });
}

async function getFestGateActivity(request, response) {
  const parsedLimit = Number.parseInt(request.query?.limit, 10);
  const activity = await gateAccessService.getGateActivity(request.params.festId, {
    limit: Number.isFinite(parsedLimit) ? parsedLimit : 10,
  });
  return response.status(200).json({ data: activity });
}

async function getFestOffers(request, response) {
  const result = await offerStatsService.listFestOffers(request.params.festId);
  return response.status(200).json({ data: result });
}

async function getOfferStats(request, response) {
  const stats = await offerStatsService.getOfferStats(
    request.params.festId,
    request.params.offerId
  );
  return response.status(200).json({ data: stats });
}

module.exports = {
  getMyPassGateStatus,
  getFestGateStats,
  getFestGateActivity,
  getFestOffers,
  getOfferStats,
};
