const {
  TEAM_NAME_MIN_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  INVITE_CODE_LENGTH,
} = require("../constants/registration-constants");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  parseCustomResponses,
  parseAcceptanceFlag,
  parseFoodPreference,
  parseNeedsAccommodation,
  parseFoodOrderCount,
  parseOfferSelections,
} = require("./registration-validator");

function buildValidationFailure(details) {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "One or more fields are invalid.",
      details,
    },
  };
}

/*
 * Shape-only. That eventId names an event, and teamName fits the same bounds the
 * team model enforces, is checked here; whether the event exists, is a team
 * event, and is open is the service's to decide, since only it loads the event.
 */
function validateCreateTeamPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};

  const eventId = requestBody.eventId;
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    details.eventId = "is required";
  }

  const teamName = typeof requestBody.teamName === "string" ? requestBody.teamName.trim() : "";
  if (teamName.length < TEAM_NAME_MIN_LENGTH || teamName.length > TEAM_NAME_MAX_LENGTH) {
    details.teamName = `must be between ${TEAM_NAME_MIN_LENGTH} and ${TEAM_NAME_MAX_LENGTH} characters`;
  }

  // The same per-registration answers the registration validator parses, shape
  // only — the fest/event rules live in the service's resolvers.
  const customResponses = parseCustomResponses(requestBody.customResponses, details);
  const hasAcceptedMedicalDeclaration = parseAcceptanceFlag(
    requestBody.hasAcceptedMedicalDeclaration,
    details
  );
  const foodPreference = parseFoodPreference(requestBody.foodPreference, details);
  const needsAccommodation = parseNeedsAccommodation(requestBody.needsAccommodation, details);
  const foodOrderCount = parseFoodOrderCount(requestBody.foodOrderCount, details);
  const offerSelections = parseOfferSelections(requestBody.offerSelections, details);

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }
  return {
    ok: true,
    value: {
      eventId: eventId.trim(),
      teamName,
      customResponses,
      hasAcceptedMedicalDeclaration,
      foodPreference,
      needsAccommodation,
      foodOrderCount,
      offerSelections,
    },
  };
}

/*
 * The invite code is a fixed-length string over the unambiguous alphabet the
 * generator uses. Normalised to uppercase here so a code typed in lower case
 * still matches the stored one; the service does the lookup.
 */
function validateJoinTeamPayload(requestBody) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const rawInviteCode = typeof requestBody.inviteCode === "string" ? requestBody.inviteCode.trim() : "";
  const inviteCode = rawInviteCode.toUpperCase();
  if (inviteCode.length !== INVITE_CODE_LENGTH || !/^[A-Z0-9]+$/.test(inviteCode)) {
    return buildValidationFailure({
      inviteCode: `must be a ${INVITE_CODE_LENGTH}-character code`,
    });
  }

  const details = {};
  // The joiner accepts their own medical declaration — resolved per joiner in the
  // service, never inherited from the leader.
  const hasAcceptedMedicalDeclaration = parseAcceptanceFlag(
    requestBody.hasAcceptedMedicalDeclaration,
    details
  );
  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }

  /*
   * Optional opt-in to captain the team. Anything other than an explicit true is
   * read as "no": a captaincy is a duty on the day, so it is never inferred from
   * a truthy string or a missing field.
   */
  const claimCaptain = requestBody.claimCaptain === true;

  return { ok: true, value: { inviteCode, hasAcceptedMedicalDeclaration, claimCaptain } };
}

module.exports = { validateCreateTeamPayload, validateJoinTeamPayload };
