const mongoose = require("mongoose");

const eventFeedbackService = require("../services/event-feedback-service");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { hasAdministratorAuthority } = require("../helpers/administrator-helpers");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

/*
 * The feedback routes hang off /events/:eventId with NO festId in the path, so
 * requireCoordinatorOrAdminMiddleware — which reads both from params — cannot
 * run here. The fest is resolved from the event instead and the same two rules
 * are applied: an administrator of the host college passes, and a coordinator
 * passes when one of their active assignments covers this event (hierarchy
 * included, so a vertical's coordinator covers its sub-events).
 *
 * This is a READ-ONLY gate. It deliberately does not check the assignment
 * window: a coordinator reading last week's feedback after their window closed
 * is exactly who the summary is for.
 */
async function assertCanReadEventFeedback(userId, eventId) {
  const permissionDenied = new ApplicationError(
    403,
    ERROR_CODES.PERMISSION_DENIED,
    "You cannot see feedback for this event."
  );

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw permissionDenied;
  }
  const event = await EventModel.findById(eventId).select("festId").lean();
  if (!event) {
    // A missing event is PERMISSION_DENIED, not 404 — the same rule the fest
    // middleware follows, so the gate cannot be used to probe which ids exist.
    throw permissionDenied;
  }

  const fest = await FestModel.findById(event.festId).select("hostCollegeId").lean();
  if (fest && (await hasAdministratorAuthority(userId, fest.hostCollegeId))) {
    return;
  }

  const coordinatorAssignments = await StaffAssignmentModel.find({
    userId,
    festId: event.festId,
    role: STAFF_ROLES.COORDINATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
  for (const assignment of coordinatorAssignments) {
    if (await assignmentCoversEvent(assignment, event._id)) {
      return;
    }
  }
  throw permissionDenied;
}

async function postEventFeedback(request, response) {
  const feedback = await eventFeedbackService.submitFeedback(
    request.authenticatedUser.userId,
    request.params.eventId,
    request.body ?? {}
  );
  return response.status(201).json({ data: feedback });
}

async function getEventFeedbackEligibility(request, response) {
  const eligibility = await eventFeedbackService.getFeedbackEligibility(
    request.authenticatedUser.userId,
    request.params.eventId
  );
  return response.status(200).json({ data: eligibility });
}

async function getEventFeedbackSummary(request, response) {
  await assertCanReadEventFeedback(request.authenticatedUser.userId, request.params.eventId);
  const summary = await eventFeedbackService.getFeedbackSummary(request.params.eventId);
  return response.status(200).json({ data: summary });
}

module.exports = {
  postEventFeedback,
  getEventFeedbackEligibility,
  getEventFeedbackSummary,
  assertCanReadEventFeedback,
};
