const addOnService = require("../services/add-on-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * Add-ons on an existing registration. Shape checks only — whether the caller
 * owns the registration and whether the offers are actually available needs the
 * database and belongs to the service.
 */

async function getAvailableAddOns(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await addOnService.listAvailableAddOns(userId, request.params.registrationId);
  return response.status(200).json({ data: result });
}

async function postRegistrationAddOns(request, response) {
  const { offerSelections } = request.body ?? {};
  if (!Array.isArray(offerSelections) || offerSelections.length === 0) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        details: { offerSelections: "must be a non-empty array" },
      },
    });
  }

  const { userId } = request.authenticatedUser;
  const result = await addOnService.addRegistrationAddOns(
    userId,
    request.params.registrationId,
    offerSelections,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = { getAvailableAddOns, postRegistrationAddOns };
