const promotionService = require("../services/promotion-service");
const { extractRequestContext } = require("../helpers/request-context");

// Participants may see this without signing in, so it is cached at the edge for
// five minutes — a banner does not change second to second, and the discover
// screen is the very first request a cold visitor makes.
const PUBLIC_CACHE_MAX_AGE_SECONDS = 300;

// Both types in one response: the home screen lays out two carousels and needs
// both arrays before it can decide which sections exist at all.
async function getPublishedPromotions(request, response) {
  const result = await promotionService.getPublishedPromotionsBoth();
  response.setHeader("Cache-Control", `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}`);
  return response.status(200).json({ data: result });
}

async function getListAllPromotions(request, response) {
  const result = await promotionService.listAllPromotions();
  return response.status(200).json({ data: result });
}

async function postCreatePromotion(request, response) {
  const promotion = await promotionService.createPromotion(
    request.authenticatedUser.userId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(201).json({ data: promotion });
}

async function patchPromotion(request, response) {
  const promotion = await promotionService.updatePromotion(
    request.authenticatedUser.userId,
    request.params.promotionId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promotion });
}

async function postPublishPromotion(request, response) {
  const promotion = await promotionService.publishPromotion(
    request.authenticatedUser.userId,
    request.params.promotionId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promotion });
}

async function postArchivePromotion(request, response) {
  const promotion = await promotionService.archivePromotion(
    request.authenticatedUser.userId,
    request.params.promotionId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promotion });
}

async function deletePromotion(request, response) {
  const result = await promotionService.deletePromotion(
    request.authenticatedUser.userId,
    request.params.promotionId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postReorderPromotions(request, response) {
  const result = await promotionService.reorderPromotions(
    request.authenticatedUser.userId,
    request.body?.promotionType,
    request.body?.orderedPromotionIds,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getPublishedPromotions,
  getListAllPromotions,
  postCreatePromotion,
  patchPromotion,
  postPublishPromotion,
  postArchivePromotion,
  deletePromotion,
  postReorderPromotions,
};
