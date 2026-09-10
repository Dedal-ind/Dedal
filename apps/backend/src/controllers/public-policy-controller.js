const consentService = require("../services/consent-service");

/*
 * The legal texts, served by the backend as THE source of truth.
 *
 * The effective read is what a consent screen renders before asking for a
 * tick; the by-id read shows a past acceptance back exactly as it was
 * accepted, because a consent record names a version id and that version's
 * text never changes. No authentication: the documents are public by nature,
 * and a participant must be able to read them before they have an account.
 */
async function getEffectivePolicyDocument(request, response) {
  const document = await consentService.getEffectivePolicyDocument(request.params.kind);
  return response.status(200).json({ data: document });
}

async function getPolicyDocumentVersion(request, response) {
  const document = await consentService.getPolicyDocumentVersion(request.params.versionId);
  return response.status(200).json({ data: document });
}

module.exports = { getEffectivePolicyDocument, getPolicyDocumentVersion };
