const verticalCodeService = require("../services/contingent-vertical-code-service");
const contingentService = require("../services/contingent-service");
const contingentPurchaseService = require("../services/contingent-purchase-service");
const contingentClaimService = require("../services/contingent-claim-service");
const {
  validateCreateContingentPayload,
  validateUpdateContingentPayload,
  validatePurchaseContingentPayload,
} = require("../validators/contingent-validator");
const { extractRequestContext } = require("../helpers/request-context");

/* D — admin CRUD. */
async function postCreateContingent(request, response) {
  const validation = validateCreateContingentPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const contingent = await contingentService.createContingent(
    request.authenticatedUser.userId,
    request.params.festId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: { contingent } });
}

async function patchUpdateContingent(request, response) {
  const validation = validateUpdateContingentPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const contingent = await contingentService.updateContingent(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.contingentId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: { contingent } });
}

async function postPublishContingent(request, response) {
  const contingent = await contingentService.publishContingent(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.contingentId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: { contingent } });
}

async function postCancelContingent(request, response) {
  const contingent = await contingentPurchaseService.cancelContingent(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.contingentId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: { contingent } });
}

async function getListFestContingents(request, response) {
  const contingents = await contingentService.listFestContingents(
    request.authenticatedUser.userId,
    request.params.festId
  );
  return response.status(200).json({ data: { contingents } });
}

async function getContingentDetail(request, response) {
  const detail = await contingentService.getContingentDetail(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.contingentId
  );
  return response.status(200).json({ data: detail });
}

/* E — the participant-facing surfaces. */
async function getPublicContingentsForEvent(request, response) {
  const contingents = await contingentService.listPublicContingentsForParentEvent(
    request.params.eventId
  );
  return response.status(200).json({ data: { contingents } });
}

async function postPurchaseContingent(request, response) {
  const validation = validatePurchaseContingentPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const purchase = await contingentPurchaseService.purchaseContingent(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.contingentId,
    validation.value.attendees,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: purchase });
}

/* F — the attendee's claims, and H — the buyer's purchases. */
async function getMyContingentClaims(request, response) {
  const claims = await contingentClaimService.listMyContingentClaims(request.authenticatedUser.userId);
  return response.status(200).json({ data: { claims } });
}

async function getMyContingentPurchases(request, response) {
  const purchases = await contingentClaimService.listMyContingentPurchases(
    request.authenticatedUser.userId
  );
  return response.status(200).json({ data: { purchases } });
}

async function postAcceptContingentClaim(request, response) {
  const result = await contingentClaimService.acceptContingentClaim(
    request.authenticatedUser.userId,
    request.params.claimId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postDeclineContingentClaim(request, response) {
  const claim = await contingentClaimService.declineContingentClaim(
    request.authenticatedUser.userId,
    request.params.claimId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: { claim } });
}

async function postCancelContingentPurchase(request, response) {
  const result = await contingentPurchaseService.cancelContingentPurchase(
    request.authenticatedUser.userId,
    request.params.contingentPurchaseGroupId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * Per-vertical code endpoints. inspect is deliberately a GET on a code the
 * caller already holds: it powers the live feedback under the join input, and
 * it must never mutate — a participant typing towards a valid code brushes past
 * many invalid prefixes.
 */
async function getInspectInviteCode(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await verticalCodeService.inspectCode(userId, request.params.inviteCode);
  return response.status(200).json({ data: result });
}

async function postRedeemVerticalCode(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await verticalCodeService.redeemVerticalCode(
    userId,
    request.body?.inviteCode,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function getPurchaseVerticalCodes(request, response) {
  const codes = await verticalCodeService.listVerticalCodesForPurchase(
    request.params.contingentPurchaseGroupId
  );
  return response.status(200).json({ data: codes });
}

async function getContingentVerticalCodes(request, response) {
  const codes = await verticalCodeService.listVerticalCodesForContingent(
    request.params.contingentId
  );
  return response.status(200).json({ data: codes });
}

module.exports = {
  getInspectInviteCode,
  postRedeemVerticalCode,
  getPurchaseVerticalCodes,
  getContingentVerticalCodes,
  postCreateContingent,
  patchUpdateContingent,
  postPublishContingent,
  postCancelContingent,
  getListFestContingents,
  getContingentDetail,
  getPublicContingentsForEvent,
  postPurchaseContingent,
  getMyContingentClaims,
  getMyContingentPurchases,
  postAcceptContingentClaim,
  postDeclineContingentClaim,
  postCancelContingentPurchase,
};
