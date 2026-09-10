const eventService = require("../services/event-service");
const {
  validateCreateEventPayload,
  validateUpdateEventPayload,
} = require("../validators/event-validator");
const { extractRequestContext } = require("../helpers/request-context");

async function postCreateEvent(request, response) {
  const validation = validateCreateEventPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const event = await eventService.createEvent(
    userId,
    request.params.festId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: event });
}

async function getListPublicEvents(request, response) {
  const { parentEventId, includeChildren } = request.query;
  const options = { includeChildren: includeChildren === "true" };
  if (parentEventId !== undefined) {
    options.parentEventId = parentEventId;
  }
  const events = await eventService.listPublicEvents(request.params.festId, options);
  return response.status(200).json({ data: events });
}

async function getListAllEventsForAdmin(request, response) {
  const { userId } = request.authenticatedUser;
  const events = await eventService.listAllEventsForAdmin(userId, request.params.festId);
  return response.status(200).json({ data: events });
}

async function getEventById(request, response) {
  const { festId, eventId } = request.params;
  const event = await eventService.getEventByIdForStaff(festId, eventId);
  return response.status(200).json({ data: event });
}

/*
 * ?direction=IN|OUT — the drill-down roster. Anything else is a 400 rather than
 * a silent default: a marshal reading the wrong direction list is worse than an
 * error.
 */
async function getEventScanParticipants(request, response) {
  const directionParameter = String(request.query.direction ?? "").toUpperCase();
  const direction = directionParameter === "IN" ? "in" : directionParameter === "OUT" ? "out" : null;
  if (!direction) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "One or more fields are invalid.",
        details: { direction: "must be IN or OUT" },
      },
    });
  }
  const { festId, eventId } = request.params;
  const participants = await eventService.listEventScanParticipants(festId, eventId, direction);
  return response.status(200).json({ data: participants });
}

async function getEventParticipants(request, response) {
  const { festId, eventId } = request.params;
  // The certificate screen needs winner1st/2nd/3rd and eliminated rows too —
  // every other caller wants the CONFIRMED-only default, so this stays opt-in.
  const includeAll = request.query.includeAll === "true";
  const participants = await eventService.listEventParticipants(festId, eventId, { includeAll });
  return response.status(200).json({ data: participants });
}

async function patchUpdateEvent(request, response) {
  const validation = validateUpdateEventPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.updateEventForStaff(
    userId,
    festId,
    eventId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: event });
}

async function postPublishEvent(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.publishEvent(userId, festId, eventId, extractRequestContext(request));
  return response.status(200).json({ data: event });
}

async function postCloseEventRegistration(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.setEventRegistrationClosed(
    userId, festId, eventId, true, extractRequestContext(request)
  );
  return response.status(200).json({ data: event });
}

async function postReopenEventRegistration(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.setEventRegistrationClosed(
    userId, festId, eventId, false, extractRequestContext(request)
  );
  return response.status(200).json({ data: event });
}

/*
 * SOFT delete. Distinct handler from deleteEventHandler, which hard-removes a
 * registration-free event and is kept for exactly that case; this is the verb an
 * event people signed up for can actually take.
 */
async function deleteEventSoftHandler(request, response) {
  const result = await eventService.softDeleteEvent(
    request.authenticatedUser.userId,
    request.params.festId,
    request.params.eventId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

/* Fest-wide registration close/reopen — one switch for every event of a fest. */
async function postCloseFestRegistration(request, response) {
  const result = await eventService.setFestRegistrationClosed(
    request.authenticatedUser.userId,
    request.params.festId,
    true,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postReopenFestRegistration(request, response) {
  const result = await eventService.setFestRegistrationClosed(
    request.authenticatedUser.userId,
    request.params.festId,
    false,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

async function postReopenCancelledEvent(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.reopenCancelledEvent(
    userId, festId, eventId, request.body ?? {}, extractRequestContext(request)
  );
  return response.status(200).json({ data: event });
}

async function deleteEventHandler(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const result = await eventService.deleteEvent(userId, festId, eventId, extractRequestContext(request));
  return response.status(200).json({ data: result });
}

/*
 * What cancelling this event would do. Read-only, its own route — a mistyped flag
 * on the destructive POST that performed a real cancellation would cost a live
 * event, so preview and cancel never share an entry point.
 */
async function getCancelEventPreview(request, response) {
  const { festId, eventId } = request.params;
  const preview = await eventService.previewCancelEvent(
    request.authenticatedUser.userId,
    festId,
    eventId
  );
  return response.status(200).json({ data: preview });
}

async function postCancelEvent(request, response) {
  const { userId } = request.authenticatedUser;
  const { festId, eventId } = request.params;
  const event = await eventService.cancelEvent(userId, festId, eventId, extractRequestContext(request));
  return response.status(200).json({ data: event });
}

async function getEventDirectory(request, response) {
  const directory = await eventService.getEventDirectory(
    request.params.festId,
    request.params.eventId
  );
  return response.status(200).json({ data: directory });
}

module.exports = {
  getEventDirectory,
  postCreateEvent,
  getListPublicEvents,
  getListAllEventsForAdmin,
  getEventById,
  getEventParticipants,
  getEventScanParticipants,
  patchUpdateEvent,
  postPublishEvent,
  postCloseEventRegistration,
  postReopenEventRegistration,
  postReopenCancelledEvent,
  deleteEventSoftHandler,
  postCloseFestRegistration,
  postReopenFestRegistration,
  deleteEventHandler,
  postCancelEvent,
  getCancelEventPreview,
};
