const volunteerDashboardService = require("../services/volunteer-dashboard-service");
const volunteerHoursService = require("../services/volunteer-hours-service");
const exportService = require("../services/export-service");
const { extractRequestContext } = require("../helpers/request-context");
const { requireCoordinatorOrAdminMiddleware } = require("../middleware/require-coordinator-or-admin-middleware");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

async function getVolunteerSummary(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await volunteerDashboardService.getVolunteerSummary(userId);
  return response.status(200).json({ data: result });
}

/*
 * Both CSVs authorise FIRST (the same shape as scan authorization — a volunteer
 * pulling someone else's checkpoint gets 403 PERMISSION_DENIED), then stream.
 */
async function getCheckpointParticipantsCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const checkpoint = await volunteerDashboardService.assertVolunteerMayExportCheckpoint(
    userId,
    request.params.checkpointId
  );
  const entitlementMatch = volunteerDashboardService.entitlementMatchForCheckpoint(checkpoint);
  await exportService.streamVolunteerCheckpointParticipantsCsv(
    userId,
    checkpoint,
    entitlementMatch,
    response,
    extractRequestContext(request)
  );
}

async function getCheckpointCheckedOutCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const checkpoint = await volunteerDashboardService.assertVolunteerMayExportCheckpoint(
    userId,
    request.params.checkpointId
  );
  await exportService.streamVolunteerCheckpointCheckedOutCsv(
    userId,
    checkpoint,
    response,
    extractRequestContext(request)
  );
}

async function getCheckpointYetToCheckInCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const checkpoint = await volunteerDashboardService.assertVolunteerMayExportCheckpoint(
    userId,
    request.params.checkpointId
  );
  const entitlementMatch = volunteerDashboardService.entitlementMatchForCheckpoint(checkpoint);
  await exportService.streamVolunteerCheckpointYetToCheckInCsv(
    userId,
    checkpoint,
    entitlementMatch,
    response,
    extractRequestContext(request)
  );
}

async function getCheckpointCheckedInCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const checkpoint = await volunteerDashboardService.assertVolunteerMayExportCheckpoint(
    userId,
    request.params.checkpointId
  );
  await exportService.streamVolunteerCheckpointCheckedInCsv(
    userId,
    checkpoint,
    response,
    extractRequestContext(request)
  );
}

/*
 * The volunteer's own service record — hours worked, per shift, computed from
 * shift windows. Volunteer-only; the service throws PERMISSION_DENIED for
 * anyone without an active volunteer assignment.
 */
async function getVolunteerHoursSummary(request, response) {
  const summary = await volunteerHoursService.getVolunteerHoursSummary(
    request.authenticatedUser.userId
  );
  return response.status(200).json({ data: summary });
}

async function pushCoordinatorCertificates(request, response) {
  const { eventId } = request.params;
  const templateFile = request.file;

  /*
   * THE PLATFORM ERROR ENVELOPE, not an ad-hoc shape.
   *
   * This answered `{ error: { template: "..." } }` — no `code`, no `message`.
   * Every client in this app reads error.code and error.message, so the refusal
   * arrived as an unreadable object and the screen fell back to its generic
   * "Failed to push certificates" alert. The rule was already right; only the
   * way it was said was wrong.
   *
   * There is no stored per-event template to fall back on: the template is
   * uploaded with each push and held in the screen's own state, never persisted
   * against the event. So "already uploaded" can only mean "attached to this
   * request", which is exactly what this checks.
   */
  if (!templateFile) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Upload a certificate template before pushing.",
      { template: "is required" }
    );
  }

  let winners = [];
  let participants = [];
  try {
    winners = JSON.parse(request.body.winners ?? "[]");
    participants = JSON.parse(request.body.participants ?? "[]");
  } catch {
    return response.status(400).json({ error: { body: "Invalid JSON in winners or participants." } });
  }

  const { pushCertificates } = require("../services/push-certificate-service");
  const results = await pushCertificates({
    eventId,
    templateBuffer: templateFile.buffer,
    templateMimeType: templateFile.mimetype,
    winners,
    participants,
  });

  return response.status(200).json({ data: results });
}

/*
 * Restored signature. When pushCoordinatorCertificates was added it was pasted
 * over this function's declaration line, leaving an orphaned body — which made
 * the whole file a syntax error and stopped the server booting at all. The
 * restoration dropped the authorization check its CSV-export siblings all
 * have (assertMayExportEvent) — re-added below, so an authenticated user with
 * no coordinator/admin assignment on this event's fest gets 403, not stats.
 */
async function getCoordinatorEventSummary(request, response) {
  const { userId } = request.authenticatedUser;
  const { eventId } = request.params;

  const { assertMayExportEvent } = require("../services/export-service");
  const event = await assertMayExportEvent(userId, eventId);

  /*
   * This used to require ../services/coordinator-panel-service, which does not
   * exist — a lazy require, so it passed startup and only threw when the route
   * was actually hit. round-service already computes exactly these numbers for
   * the event overview, so it is reused rather than duplicated.
   */
  const { getEventOverviewStats } = require("../services/round-service");
  const stats = await getEventOverviewStats(eventId);

  return response.status(200).json({
    data: {
      eventId: String(event._id),
      eventName: event.eventName ?? null,
      startsAt: event.startsAt ?? null,
      endsAt: event.endsAt ?? null,
      venue: event.venue ?? null,
      ...stats,
    },
  });
}

async function getCoordinatorParticipantsCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const { eventId } = request.params;
  await exportService.streamCoordinatorEventParticipantsCsv(userId, eventId, response, extractRequestContext(request));
}

async function getCoordinatorCheckedInCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const { eventId } = request.params;
  await exportService.streamCoordinatorEventCheckedInCsv(userId, eventId, response, extractRequestContext(request));
}

async function getCoordinatorCheckedOutCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const { eventId } = request.params;
  await exportService.streamCoordinatorEventCheckedOutCsv(userId, eventId, response, extractRequestContext(request));
}

async function getCoordinatorYetToCheckInCsv(request, response) {
  const { userId } = request.authenticatedUser;
  const { eventId } = request.params;
  await exportService.streamCoordinatorEventYetToCheckInCsv(userId, eventId, response, extractRequestContext(request));
}

module.exports = {
  getCheckpointCheckedOutCsv,
  getCheckpointYetToCheckInCsv,
  getVolunteerHoursSummary,
  getVolunteerSummary,
  getCheckpointParticipantsCsv,
  getCheckpointCheckedInCsv,
  getCoordinatorEventSummary,
  getCoordinatorParticipantsCsv,
  getCoordinatorCheckedInCsv,
  getCoordinatorCheckedOutCsv,
  getCoordinatorYetToCheckInCsv,
  pushCoordinatorCertificates,
};
