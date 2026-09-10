const userService = require("../services/user-service");
const { validateUpdateProfilePayload } = require("../validators/user-validator");
const consentService = require("../services/consent-service");
const { extractRequestContext } = require("../helpers/request-context");
const { POLICY_DOCUMENT_KINDS } = require("../constants/consent-constants");

async function getMyProfile(request, response) {
  const { userId } = request.authenticatedUser;
  const user = await userService.getMyProfile(userId);
  return response.status(200).json({ data: user });
}

async function patchMyProfile(request, response) {
  const validation = validateUpdateProfilePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const user = await userService.updateUserProfile(
    userId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: user });
}

/* What the caller currently stands accepted on, per document, and whether
   that is the version in effect — the predicate a re-prompt will key off. */
async function getMyConsents(request, response) {
  const { userId } = request.authenticatedUser;
  const standing = await consentService.getConsentStanding(userId);
  return response.status(200).json({ data: standing });
}

/*
 * Withdrawal is as easy to record as acceptance: one call, one appended
 * record. The document kind is the whole body.
 */
async function postWithdrawMyConsent(request, response) {
  const { documentKind } = request.body ?? {};
  if (!Object.values(POLICY_DOCUMENT_KINDS).includes(documentKind)) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        details: { documentKind: `must be one of ${Object.values(POLICY_DOCUMENT_KINDS).join(", ")}` },
      },
    });
  }
  const { userId } = request.authenticatedUser;
  const record = await consentService.recordWithdrawal(
    { userId, documentKind },
    extractRequestContext(request)
  );
  return response.status(201).json({ data: record.toJSON() });
}

async function deleteMyAccount(request, response) {
  const { userId } = request.authenticatedUser;
  await userService.deleteMyAccount(userId);
  return response.status(200).json({ data: { deleted: true } });
}

async function postSaveEvent(request, response) {
  const result = await userService.saveEventForUser(
    request.authenticatedUser.userId,
    request.params.eventId
  );
  return response.status(200).json({ data: result });
}

async function deleteSaveEvent(request, response) {
  const result = await userService.unsaveEventForUser(
    request.authenticatedUser.userId,
    request.params.eventId
  );
  return response.status(200).json({ data: result });
}

async function getSavedEvents(request, response) {
  const result = await userService.listSavedEventsForUser(request.authenticatedUser.userId);
  return response.status(200).json({ data: result });
}

module.exports = {
  getMyConsents,
  postWithdrawMyConsent,
  getMyProfile,
  patchMyProfile,
  deleteMyAccount,
  postSaveEvent,
  deleteSaveEvent,
  getSavedEvents,
};
