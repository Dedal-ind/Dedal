const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The declaration's wording lives in the frontend's brand strings — one
 * canonical text, never per-event — so the server holds only its key. Sent back
 * with the rejection so a client can echo the exact text it failed to accept
 * rather than guessing which copy the refusal referred to.
 */
const DECLARATION_STRING_KEY = "MEDICAL_DECLARATION_BODY";

/*
 * Returns the moment of acceptance, or null when the event asks for none.
 *
 * A truthy flag on an event that does not require a declaration is ignored
 * rather than rejected: the client is harmlessly over-reporting, and refusing it
 * would break a registration for a reason the participant cannot act on. The
 * timestamp stays null there, so the record never claims a declaration was
 * accepted for an event that never asked for one.
 */
function resolveMedicalAcceptance(event, hasAcceptedMedicalDeclaration) {
  if (!event.requiresMedicalDeclaration) {
    return null;
  }
  if (hasAcceptedMedicalDeclaration !== true) {
    throw new ApplicationError(
      400,
      ERROR_CODES.MEDICAL_DECLARATION_REQUIRED,
      "This event requires you to accept the medical declaration before registering.",
      { declarationStringKey: DECLARATION_STRING_KEY }
    );
  }
  return new Date();
}

module.exports = { resolveMedicalAcceptance, DECLARATION_STRING_KEY };
