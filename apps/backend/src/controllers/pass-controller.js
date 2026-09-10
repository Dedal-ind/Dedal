const passService = require("../services/pass-service");
const { ERROR_CODES } = require("../constants/error-codes");

async function getMyPassForFest(request, response) {
  const { festId } = request.query;
  if (!festId) {
    return response.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "festId is required.",
        details: { festId: "is required" },
      },
    });
  }

  const { userId } = request.authenticatedUser;
  const pass = await passService.getMyPass(userId, festId);
  return response.status(200).json({ data: pass });
}

async function getMyAllPasses(request, response) {
  const { userId } = request.authenticatedUser;
  const passes = await passService.getMyPasses(userId);
  return response.status(200).json({ data: passes });
}

/*
 * Resend the caller's OWN pass email — the owner scope, deliberately tighter
 * than admin-only: nobody but the holder needs to trigger a mail to the
 * holder's inbox, and it keeps the route free of a fest-admin lookup. Bypasses
 * the passEmailSentAt once-guard (that guard exists to stop AUTOMATIC repeats,
 * not a deliberate "I lost the email" request).
 */
async function postResendMyPassEmail(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await passService.resendMyPassEmail(userId, request.params.passId);
  return response.status(200).json({ data: result });
}

module.exports = { getMyPassForFest, getMyAllPasses, postResendMyPassEmail };
