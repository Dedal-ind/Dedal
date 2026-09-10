const festStaffService = require("../services/fest-staff-service");
const { validateAssignToEventsPayload } = require("../validators/staff-assignment-validator");
const { extractRequestContext } = require("../helpers/request-context");

async function postAssignStaffToEvents(request, response) {
  const validation = validateAssignToEventsPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const assignment = await festStaffService.assignStaffToEvents(
    userId,
    request.params.festId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: assignment });
}

async function getFestStaffRoster(request, response) {
  const result = await festStaffService.getFestStaffRoster(request.params.festId);
  return response.status(200).json({ data: result });
}

async function getEventStaffRoster(request, response) {
  const { festId, eventId } = request.params;
  const result = await festStaffService.getEventStaffRoster(festId, eventId);
  return response.status(200).json({ data: result });
}

module.exports = { postAssignStaffToEvents, getFestStaffRoster, getEventStaffRoster };
