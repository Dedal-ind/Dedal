const dashboardService = require("../services/dashboard-service");
const { resolveAssignmentEventScope } = require("../helpers/assignment-coverage-helpers");

/*
 * One endpoint serves both roles. The coordinator-or-admin gate has already
 * attached the caller's context: an administrator sees the whole fest, while a
 * coordinator is scoped to the events their assignment names and does not see the
 * fest-wide gate headcount.
 *
 * A coordinator assigned to no event in particular is assigned to all of them —
 * resolveAssignmentEventScope is what says so. Reading eventIds directly here
 * used to hand the service an empty array, which scoped the dashboard to nothing
 * and showed a fest-wide coordinator zeroes across the board.
 *
 * This widens only what they see. Every write still goes through the gates that
 * were already there.
 */
async function getDashboard(request, response) {
  const { festId } = request.params;
  const isAdministrator = Boolean(request.isAdministrator);
  const scopeEventIds = isAdministrator
    ? null
    : resolveAssignmentEventScope(request.staffAssignment);

  const dashboard = await dashboardService.getFestDashboard(festId, {
    scopeEventIds,
    includeGate: isAdministrator,
  });
  return response.status(200).json({ data: dashboard });
}

module.exports = { getDashboard };
