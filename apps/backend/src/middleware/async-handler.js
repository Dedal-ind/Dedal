function asyncHandler(handlerFunction) {
  return (request, response, next) =>
    Promise.resolve(handlerFunction(request, response, next)).catch(next);
}

module.exports = { asyncHandler };
