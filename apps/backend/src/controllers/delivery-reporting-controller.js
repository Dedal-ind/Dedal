const reporting = require("../services/delivery-reporting-service");

/*
 * Delivery reports, platform admin only, reads only. Every one takes ?from
 * and ?to as UTC days (inclusive; default the last thirty days) and answers
 * from rollups. No cache header, matching platform analytics: the numbers
 * change with every rollup run and an admin refreshing wants the latest.
 */
async function getPlatformOverview(request, response) {
  return response.status(200).json({ data: await reporting.getPlatformOverview(request.query) });
}

async function getCampaignReport(request, response) {
  return response
    .status(200)
    .json({ data: await reporting.getCampaignReport(request.params.campaignId, request.query) });
}

async function getCampaignCreativesReport(request, response) {
  return response
    .status(200)
    .json({ data: await reporting.getCampaignCreativesReport(request.params.campaignId, request.query) });
}

async function getPlacementReport(request, response) {
  return response
    .status(200)
    .json({ data: await reporting.getPlacementReport(request.params.placementKey, request.query) });
}

async function getPromoterSummary(request, response) {
  return response
    .status(200)
    .json({ data: await reporting.getPromoterSummary(request.params.promoterId, request.query) });
}

module.exports = {
  getPlatformOverview,
  getCampaignReport,
  getCampaignCreativesReport,
  getPlacementReport,
  getPromoterSummary,
};
