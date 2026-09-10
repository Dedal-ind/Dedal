const staffAssignmentService = require("../services/staff-assignment-service");
const {
  validateAssignStaffPayload,
  validateRevokeAssignmentPayload,
} = require("../validators/staff-assignment-validator");
const { extractRequestContext } = require("../helpers/request-context");

async function postAssignStaffMember(request, response) {
  const validation = validateAssignStaffPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const assignment = await staffAssignmentService.assignStaffMember(
    userId,
    request.params.festId,
    validation.value,
    extractRequestContext(request)
  );
  return response.status(201).json({ data: assignment });
}

async function getStaffAssignmentsForFest(request, response) {
  const { userId } = request.authenticatedUser;
  const assignments = await staffAssignmentService.listStaffAssignmentsForFest(
    userId,
    request.params.festId
  );
  return response.status(200).json({ data: assignments });
}

async function postRevokeStaffAssignment(request, response) {
  const validation = validateRevokeAssignmentPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const { festId, assignmentId } = request.params;
  const assignment = await staffAssignmentService.revokeStaffAssignment(
    userId,
    festId,
    assignmentId,
    validation.value.reason,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: assignment });
}

async function getMyStaffAssignments(request, response) {
  const { userId } = request.authenticatedUser;
  const assignments = await staffAssignmentService.listMyStaffAssignments(userId);
  return response.status(200).json({ data: assignments });
}

module.exports = {
  postAssignStaffMember,
  getStaffAssignmentsForFest,
  postRevokeStaffAssignment,
  getMyStaffAssignments,
};
