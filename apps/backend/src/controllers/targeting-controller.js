const targetingService = require("../services/targeting-service");

/*
 * GET  /targeting/options    what an editor may offer per dimension
 * POST /targeting/estimate   { targeting } → reach snapshot
 * POST /targeting/validate   { targeting } → { ok, errors, warnings }
 *
 * The two POSTs are READS that take a predicate in the body — a predicate is
 * a nested object no query string carries well. Nothing is written. Nothing
 * is cached: every response is computed from the data as it stands.
 */
function noStore(response) {
  response.setHeader("Cache-Control", "no-store, private");
}

async function getTargetingOptions(request, response) {
  noStore(response);
  return response.status(200).json({ data: await targetingService.getTargetingOptions() });
}

function readTargeting(request) {
  const targeting = request.body?.targeting;
  return targeting === undefined ? {} : targeting;
}

async function postEstimateReach(request, response) {
  const targeting = readTargeting(request);
  // Shape first: an estimate over a malformed predicate would be a number
  // that means nothing.
  const validation = await targetingService.validateTargeting(targeting);
  if (!validation.ok) {
    return response.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "The targeting predicate is invalid.", details: validation.errors },
    });
  }
  noStore(response);
  return response.status(200).json({ data: await targetingService.estimateReach(targeting) });
}

async function postValidateTargeting(request, response) {
  noStore(response);
  return response.status(200).json({ data: await targetingService.validateTargeting(readTargeting(request)) });
}

module.exports = { getTargetingOptions, postEstimateReach, postValidateTargeting };
