const codePurchaseService = require("../services/contingent-code-purchase-service");
const codeRedemptionService = require("../services/contingent-code-redemption-service");
const {
  validateContingentCodeParameter,
  validateRedeemContingentCodePayload,
} = require("../validators/contingent-validator");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * The code-distribution contingent endpoints. Shape checks only; who may buy,
 * whether a code is live and every team rule need the database and live in the
 * two services.
 */

async function postPurchaseContingentCodes(request, response) {
  const result = await codePurchaseService.purchaseContingentCodes(
    request.authenticatedUser.userId,
    request.params.contingentId,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: result });
}

async function getMyContingentCodes(request, response) {
  const purchases = await codePurchaseService.listMyCodePurchases(request.authenticatedUser.userId);
  return response.status(200).json({ data: { purchases } });
}

async function getInspectContingentCode(request, response) {
  const codeValidation = validateContingentCodeParameter(request.params.code);
  if (!codeValidation.ok) {
    return response.status(400).json({ error: codeValidation.error });
  }
  const result = await codeRedemptionService.inspectContingentCode(
    request.authenticatedUser.userId,
    codeValidation.value.code
  );
  return response.status(200).json({ data: result });
}

async function postRedeemContingentCode(request, response) {
  const codeValidation = validateContingentCodeParameter(request.params.code);
  if (!codeValidation.ok) {
    return response.status(400).json({ error: codeValidation.error });
  }
  const payloadValidation = validateRedeemContingentCodePayload(request.body);
  if (!payloadValidation.ok) {
    return response.status(400).json({ error: payloadValidation.error });
  }
  const result = await codeRedemptionService.redeemContingentCode(
    request.authenticatedUser.userId,
    codeValidation.value.code,
    payloadValidation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: result });
}

module.exports = {
  postPurchaseContingentCodes,
  getMyContingentCodes,
  getInspectContingentCode,
  postRedeemContingentCode,
};
