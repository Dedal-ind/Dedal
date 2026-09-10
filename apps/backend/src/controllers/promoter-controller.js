const promoterService = require("../services/promoter-service");
const { extractRequestContext } = require("../helpers/request-context");
const {
  validateCreatePromoterPayload,
  validateUpdatePromoterPayload,
  validateListPromotersQuery,
  validateCreateCreativePayload,
  validateUpdateCreativePayload,
  validateListCreativesQuery,
} = require("../validators/promoter-validators");

/* Shape checks live in the validator; the service decides legality. */

async function getListPromoters(request, response) {
  const validation = validateListPromotersQuery(request.query ?? {});
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const result = await promoterService.listPromoters(validation.value);
  return response.status(200).json({ data: result });
}

async function getPromoter(request, response) {
  const promoter = await promoterService.getPromoter(request.params.promoterId);
  return response.status(200).json({ data: promoter });
}

async function postCreatePromoter(request, response) {
  const validation = validateCreatePromoterPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const promoter = await promoterService.createPromoter(
    request.authenticatedUser.userId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: promoter });
}

async function patchPromoter(request, response) {
  const validation = validateUpdatePromoterPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const promoter = await promoterService.updatePromoter(
    request.authenticatedUser.userId,
    request.params.promoterId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promoter });
}

async function postArchivePromoter(request, response) {
  const promoter = await promoterService.archivePromoter(
    request.authenticatedUser.userId,
    request.params.promoterId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promoter });
}

async function postRestorePromoter(request, response) {
  const promoter = await promoterService.restorePromoter(
    request.authenticatedUser.userId,
    request.params.promoterId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: promoter });
}

async function getListCreatives(request, response) {
  const validation = validateListCreativesQuery(request.query ?? {});
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const result = await promoterService.listCreatives(validation.value);
  return response.status(200).json({ data: result });
}

async function getCreative(request, response) {
  const creative = await promoterService.getCreative(request.params.creativeId);
  return response.status(200).json({ data: creative });
}

async function postCreateCreative(request, response) {
  const validation = validateCreateCreativePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const creative = await promoterService.createCreative(
    request.authenticatedUser.userId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: creative });
}

async function patchCreative(request, response) {
  const validation = validateUpdateCreativePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const creative = await promoterService.updateCreative(
    request.authenticatedUser.userId,
    request.params.creativeId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: creative });
}

async function postArchiveCreative(request, response) {
  const creative = await promoterService.archiveCreative(
    request.authenticatedUser.userId,
    request.params.creativeId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: creative });
}

async function postRestoreCreative(request, response) {
  const creative = await promoterService.restoreCreative(
    request.authenticatedUser.userId,
    request.params.creativeId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: creative });
}

module.exports = {
  getListPromoters,
  getPromoter,
  postCreatePromoter,
  patchPromoter,
  postArchivePromoter,
  postRestorePromoter,
  getListCreatives,
  getCreative,
  postCreateCreative,
  patchCreative,
  postArchiveCreative,
  postRestoreCreative,
};
