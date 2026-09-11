const eventNotificationService = require("../services/event-notification-service");
const exportService = require("../services/export-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * The coordinator's bulk-message surface, and the per-round participant sheet.
 * Both hang off the fest-scoped event router, so requireCoordinatorOrAdmin has
 * already proved the caller covers this event before any of this runs.
 */

async function getNotifyParticipantsPreview(request, response) {
  const preview = await eventNotificationService.getNotificationPreview(request.params.eventId);
  return response.status(200).json({ data: preview });
}

async function postNotifyParticipants(request, response) {
  const result = await eventNotificationService.notifyEventParticipants(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * Admin broadcast: one message to a chosen audience (participants, staff, or
 * both) of one event. The route mounts it behind administratorOnly.
 */
async function postBroadcastMessage(request, response) {
  const result = await eventNotificationService.broadcastEventMessage(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.eventId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * Fest-wide admin broadcast: one message to a chosen audience across EVERY
 * event of the fest, resolved and deduplicated once. Mounted on the fest router
 * (no :eventId in the path) behind administratorOnly, same as the per-event
 * verb. See broadcastFestMessage for why this is not a loop over that one.
 */
async function postFestBroadcastMessage(request, response) {
  const result = await eventNotificationService.broadcastFestMessage(
    request.authenticatedUser.userId,
    request.params.festId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/*
 * The round sheet. The shared CSV spine writes the headers, streams the rows and
 * records the data.exported audit row; the filename is rewritten afterwards
 * because that spine names files "{type}-{festSlug}-{date}.csv" and the spec for
 * this one is "round-{n}-{eventSlug}-{date}.csv".
 */
async function getRoundParticipantsCsv(request, response) {
  const { festId, eventId, roundId } = request.params;
  await exportService.streamRoundParticipantsCsv(
    request.authenticatedUser.userId,
    festId,
    eventId,
    roundId,
    response,
    extractRequestContext(request)
  );
}

async function postInAppBroadcast(request, response) {
  const result = await eventNotificationService.broadcastInAppMessage(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.eventId,
    request.body ?? {},
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  postInAppBroadcast,
  getNotifyParticipantsPreview,
  postNotifyParticipants,
  postBroadcastMessage,
  postFestBroadcastMessage,
  getRoundParticipantsCsv,
};
