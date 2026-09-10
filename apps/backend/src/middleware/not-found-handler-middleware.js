const { ERROR_CODES } = require("../constants/error-codes");

function notFoundHandlerMiddleware(request, response) {
  response.status(404).json({
    error: {
      code: ERROR_CODES.ROUTE_NOT_FOUND,
      message: "Route not found.",
    },
  });
}

module.exports = { notFoundHandlerMiddleware };
