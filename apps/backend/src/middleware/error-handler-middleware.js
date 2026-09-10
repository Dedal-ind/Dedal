const { applicationConfig } = require("../config/application-config");
const { ERROR_CODES } = require("../constants/error-codes");
const { ApplicationError } = require("../helpers/application-error");

const GENERIC_INTERNAL_MESSAGE = "Internal server error. Please try again.";

/*
 * A model's pre('validate') hook reports a broken cross-field invariant as a
 * Mongoose ValidationError, which carries no statusCode and would otherwise be
 * reported as a 500. It is a bad request, and its `errors` map is already shaped
 * like the per-field details every validator here produces.
 */
function isMongooseValidationError(error) {
  return error?.name === "ValidationError" && error.errors;
}

function toFieldDetails(mongooseValidationError) {
  const details = {};
  for (const [fieldName, fieldError] of Object.entries(mongooseValidationError.errors)) {
    details[fieldName] = fieldError.message;
  }
  return details;
}

// eslint-disable-next-line no-unused-vars
function errorHandlerMiddleware(error, request, response, next) {
  if (isMongooseValidationError(error)) {
    error.statusCode = 400;
    error.errorCode = ERROR_CODES.VALIDATION_FAILED;
    error.details = toFieldDetails(error);
    error.message = "One or more fields are invalid.";
  }

  const statusCode = error.statusCode || 500;
  const errorCode = error.errorCode || ERROR_CODES.INTERNAL_ERROR;

  /*
   * An ApplicationError says what it means and its message is written to be
   * read. Anything else reaching a 500 is unexpected — a driver fault, a
   * programming error — and its message was written for us, not for a client.
   * Mongo's are the pointed case: a connection error names host:port and the
   * replica set, and a duplicate-key error quotes the index and the offending
   * value back. None of that is a client's business.
   *
   * A deliberate 5xx ApplicationError keeps its message: someone chose it.
   */
  const isUnexpectedServerFault = statusCode >= 500 && !(error instanceof ApplicationError);
  const message = isUnexpectedServerFault
    ? GENERIC_INTERNAL_MESSAGE
    : error.message || GENERIC_INTERNAL_MESSAGE;

  /*
   * The only place this error is ever recorded. Sanitising the response without
   * this would not hide the fault from an attacker so much as from us — an
   * unexpected 500 would leave no trace anywhere. The stack goes with it,
   * because the message alone rarely says where it came from.
   */
  if (isUnexpectedServerFault) {
    console.error(
      `Unhandled ${statusCode} on ${request.method} ${request.originalUrl}:`,
      error.stack || error.message
    );
  }

  const errorBody = {
    code: errorCode,
    message,
  };

  if (error.details) {
    errorBody.details = error.details;
  }

  /*
   * Proxies and well-behaved clients honour the header, not the payload. Any
   * error carrying retryAfterSeconds advertises it both ways.
   */
  if (Number.isInteger(error.details?.retryAfterSeconds)) {
    response.set("Retry-After", String(error.details.retryAfterSeconds));
  }

  if (applicationConfig.applicationEnvironment === "development" && error.stack) {
    errorBody.details = { ...(errorBody.details || {}), stack: error.stack };
  }

  response.status(statusCode).json({ error: errorBody });
}

module.exports = { errorHandlerMiddleware };
