const volunteerShiftService = require("../services/volunteer-shift-service");
const { extractRequestContext } = require("../helpers/request-context");

/*
 * The fest-scoped routes run behind requireCoordinatorOrAdminMiddleware, which
 * attaches request.staffAssignment and request.isAdministrator. The actor bundles
 * those with the request context so the service can scope by role and audit with ip.
 */
function buildActor(request) {
  return {
    userId: request.authenticatedUser.userId,
    isAdministrator: Boolean(request.isAdministrator),
    assignment: request.staffAssignment,
    context: extractRequestContext(request),
  };
}

async function postCreateShift(request, response) {
  const { userId, checkpointId, startsAt, endsAt } = request.body;
  const result = await volunteerShiftService.createShift({
    festId: request.params.festId,
    userId,
    checkpointId,
    startsAt,
    endsAt,
    actor: buildActor(request),
  });
  return response.status(201).json({ data: result });
}

async function getFestShifts(request, response) {
  const result = await volunteerShiftService.listShiftsForFest({
    festId: request.params.festId,
    actor: buildActor(request),
    filters: request.query,
  });
  return response.status(200).json({ data: result });
}

async function getShift(request, response) {
  const result = await volunteerShiftService.getShiftById({
    festId: request.params.festId,
    shiftId: request.params.shiftId,
    actor: buildActor(request),
  });
  return response.status(200).json({ data: result });
}

async function patchShift(request, response) {
  const { checkpointId, startsAt, endsAt } = request.body;
  const result = await volunteerShiftService.updateShift({
    festId: request.params.festId,
    shiftId: request.params.shiftId,
    actor: buildActor(request),
    updates: { checkpointId, startsAt, endsAt },
  });
  return response.status(200).json({ data: result });
}

async function postCancelShift(request, response) {
  const result = await volunteerShiftService.cancelShift({
    festId: request.params.festId,
    shiftId: request.params.shiftId,
    actor: buildActor(request),
    cancellationReason: request.body.cancellationReason,
  });
  return response.status(200).json({ data: result });
}

async function getFestVolunteers(request, response) {
  const result = await volunteerShiftService.listFestVolunteers({
    festId: request.params.festId,
    actor: buildActor(request),
  });
  return response.status(200).json({ data: result });
}

async function getMyShifts(request, response) {
  const result = await volunteerShiftService.listMyShifts({
    actor: { userId: request.authenticatedUser.userId },
    filters: request.query,
  });
  return response.status(200).json({ data: result });
}

module.exports = {
  postCreateShift,
  getFestShifts,
  getShift,
  patchShift,
  postCancelShift,
  getFestVolunteers,
  getMyShifts,
};
