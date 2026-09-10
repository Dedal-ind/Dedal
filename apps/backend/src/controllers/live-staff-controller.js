const liveStaffService = require("../services/live-staff-service");

/*
 * The coordinator/admin middleware has already attached the assignment it matched
 * and whether it was an administrator one; both are handed to the service, which
 * narrows a coordinator to the event they actually cover.
 */
async function getLiveEventStaff(request, response) {
  const { festId, eventId } = request.params;
  const snapshot = await liveStaffService.fetchLiveEventStaff(festId, eventId, {
    staffAssignment: request.staffAssignment,
    isAdministrator: request.isAdministrator,
  });
  return response.status(200).json({ data: snapshot });
}

module.exports = { getLiveEventStaff };
