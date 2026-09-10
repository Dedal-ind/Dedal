const registrationService = require("../services/registration-service");
const teamService = require("../services/team-service");
const {
  validateSoloRegistrationPayload,
  validateTeamRegistrationPayload,
} = require("../validators/registration-validator");
const { validateJoinTeamPayload } = require("../validators/team-validator");
const { extractRequestContext } = require("../helpers/request-context");

async function postRegisterSolo(request, response) {
  const validation = validateSoloRegistrationPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const result = await registrationService.registerParticipantSolo(
    userId,
    request.params.eventId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: result });
}

async function postRegisterTeam(request, response) {
  const validation = validateTeamRegistrationPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const result = await registrationService.registerParticipantTeam(
    userId,
    request.params.eventId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: result });
}

async function postCancelMyRegistration(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await registrationService.cancelMyRegistration(
    userId,
    request.params.eventId,
    request.body?.cancellationReason,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * Keyed by registration id rather than event id, because an actor may cancel a
 * row that is not their own. Authorisation is the service's: it derives the
 * policy from who the caller is to this registration, so there is no separate
 * staff endpoint to keep in step.
 */
/*
 * Releasing the caller's own unpaid hold for an event so they can start the form
 * over — the "cancel & retry" action the registration form offers when a retry
 * meets a checkout still in flight. Event-keyed, since the caller is acting on
 * "my hold for this event", not on a registration id they may not know.
 */
async function postCancelMyPendingRegistration(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await registrationService.cancelMyPendingRegistration(
    userId,
    request.params.eventId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postCancelRegistration(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await registrationService.cancelRegistration({
    registrationId: request.params.registrationId,
    actorUserId: userId,
    cancellationReason: request.body?.cancellationReason,
    context: extractRequestContext(request),
  });
  return response.status(200).json({ data: result });
}

async function postConfirmPayment(request, response) {
  const paymentGroupId = request.body?.paymentGroupId;
  const paymentReference = request.body?.paymentReference;
  if (typeof paymentGroupId !== "string" || paymentGroupId.trim().length === 0) {
    return response.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "paymentGroupId is required.", details: { paymentGroupId: "is required" } },
    });
  }
  const { userId } = request.authenticatedUser;
  const result = await registrationService.confirmPayment(
    userId,
    paymentGroupId.trim(),
    typeof paymentReference === "string" ? paymentReference.trim() : null,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postJoinTeam(request, response) {
  const validation = validateJoinTeamPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const result = await teamService.joinTeamByInviteCode(
    userId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function getListMyRegistrations(request, response) {
  const { userId } = request.authenticatedUser;
  const registrations = await registrationService.listMyRegistrations(userId);
  return response.status(200).json({ data: registrations });
}

async function getMyRegistrationById(request, response) {
  const { userId } = request.authenticatedUser;
  const registration = await registrationService.getRegistrationDetail(
    userId,
    request.params.registrationId
  );
  return response.status(200).json({ data: registration });
}

module.exports = {
  postRegisterSolo,
  postRegisterTeam,
  postConfirmPayment,
  postCancelMyRegistration,
  postCancelMyPendingRegistration,
  postCancelRegistration,
  postJoinTeam,
  getListMyRegistrations,
  getMyRegistrationById,
};
