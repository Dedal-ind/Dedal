const deliveryService = require("../services/delivery-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * POST /delivery/events   { events: [{ token, kind, occurredAt? }, ...] }
 *
 * A batch, because the client flushes several events together when a page
 * unloads. Each is processed independently and answered independently: the
 * response carries one outcome per input, in order — recorded, duplicate, or
 * rejected with a reason. The HTTP status is 200 whenever the batch was
 * understood at all; a bad event is an outcome, not a failure of the call.
 *
 * The body names tokens and kinds only. Campaign, creative, placement and the
 * cap subject come from the stored token. Anything else in an event is
 * ignored.
 */
async function postDeliveryEvents(request, response) {
  const { events } = request.body ?? {};
  if (!Array.isArray(events)) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        details: { events: "must be an array of { token, kind }" },
      },
    });
  }
  const { userAgent } = extractRequestContext(request);
  const outcomes = await deliveryService.ingestEvents(events, { userAgent });
  response.setHeader("Cache-Control", "no-store, private");
  return response.status(200).json({ data: { outcomes } });
}

module.exports = { postDeliveryEvents };
