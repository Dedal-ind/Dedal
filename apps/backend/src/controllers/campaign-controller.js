const campaignAdminService = require("../services/campaign-admin-service");
const { extractRequestContext } = require("../helpers/request-context");
const {
  validateCreateCampaignPayload,
  validateUpdateCampaignPayload,
  validateListCampaignsQuery,
  validateAttachCreativePayload,
  validateUpdateAssociationPayload,
} = require("../validators/campaign-validators");

/* Shape checks live in the validator; the service decides legality. */

function invalid(response, validation) {
  return response.status(400).json({ error: validation.error });
}

async function getListCampaigns(request, response) {
  const validation = validateListCampaignsQuery(request.query ?? {});
  if (!validation.ok) {
    return invalid(response, validation);
  }
  return response.status(200).json({ data: await campaignAdminService.listCampaigns(validation.value) });
}

async function getCampaign(request, response) {
  return response.status(200).json({ data: await campaignAdminService.getCampaign(request.params.campaignId) });
}

async function postCreateCampaign(request, response) {
  const validation = validateCreateCampaignPayload(request.body);
  if (!validation.ok) {
    return invalid(response, validation);
  }
  const campaign = await campaignAdminService.createCampaign(
    request.authenticatedUser.userId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: campaign });
}

async function patchCampaign(request, response) {
  const validation = validateUpdateCampaignPayload(request.body);
  if (!validation.ok) {
    return invalid(response, validation);
  }
  const campaign = await campaignAdminService.updateCampaign(
    request.authenticatedUser.userId,
    request.params.campaignId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: campaign });
}

function transition(method) {
  return async function handleTransition(request, response) {
    const campaign = await campaignAdminService[method](
      request.authenticatedUser.userId,
      request.params.campaignId,
      extractRequestContext(request)
    );
    return response.status(200).json({ data: campaign });
  };
}

async function postAttachCreative(request, response) {
  const validation = validateAttachCreativePayload(request.body);
  if (!validation.ok) {
    return invalid(response, validation);
  }
  const association = await campaignAdminService.attachCreative(
    request.authenticatedUser.userId,
    request.params.campaignId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: association });
}

async function patchAssociation(request, response) {
  const validation = validateUpdateAssociationPayload(request.body);
  if (!validation.ok) {
    return invalid(response, validation);
  }
  const association = await campaignAdminService.updateAssociation(
    request.authenticatedUser.userId,
    request.params.campaignId,
    request.params.creativeId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: association });
}

async function deleteAssociation(request, response) {
  const result = await campaignAdminService.detachCreative(
    request.authenticatedUser.userId,
    request.params.campaignId,
    request.params.creativeId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getListCampaigns,
  getCampaign,
  postCreateCampaign,
  patchCampaign,
  postPublishCampaign: transition("publishCampaign"),
  postPauseCampaign: transition("pauseCampaign"),
  postResumeCampaign: transition("resumeCampaign"),
  postArchiveCampaign: transition("archiveCampaign"),
  deleteCampaign: transition("deleteCampaign"),
  postAttachCreative,
  patchAssociation,
  deleteAssociation,
};
