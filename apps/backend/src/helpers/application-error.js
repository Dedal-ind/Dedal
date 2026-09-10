const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The single throwable this codebase uses for expected failures. Anything
 * thrown with one of these reaches error-handler-middleware with a real
 * statusCode and a stable errorCode, so expected auth failures never surface
 * as a 500.
 */
class ApplicationError extends Error {
  constructor(statusCode, errorCode, message, details) {
    super(message);
    this.name = "ApplicationError";
    this.statusCode = statusCode;
    this.errorCode = errorCode || ERROR_CODES.INTERNAL_ERROR;
    if (details) {
      this.details = details;
    }
    Error.captureStackTrace(this, ApplicationError);
  }
}

module.exports = { ApplicationError };
