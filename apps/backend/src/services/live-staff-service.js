const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { CHECKPOINT_TYPES } = require("../constants/scan-constants");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");
const {
  summariseCheckpointScans,
  summariseVolunteerScans,
  buildRecentScans,
} = require("../helpers/live-staff-helpers");
const {
  loadShiftRows,
  loadUserDirectory,
  toShiftIdentity,
} = require("../helpers/live-staff-shift-helpers");

/*
 * A gate is included alongside the event's own door because a participant
 * arriving through the gate on their way to this event is observable there: the
 * gate's traffic is part of this event's live picture, not separate from it.
 */
async function loadAssociatedCheckpoints(festId, eventId) {
  return CheckpointModel.find({
    festId,
    $or: [{ eventId }, { checkpointType: CHECKPOINT_TYPES.GATE }],
  })
    .select("checkpointName checkpointType")
    .lean();
}

/*
 * The middleware has already established that the caller is an administrator of
 * the host college or a coordinator somewhere in this fest. This narrows the
 * coordinator case to the event they actually cover, so a coordinator of a
 * different event in the same fest is refused — 403 rather than 404, because the
 * fest and event do exist and hiding that from fest staff buys nothing.
 */
async function assertAssignmentCoversEvent(eventId, staffAssignment, isAdministrator) {
  if (isAdministrator) {
    return;
  }
  if (!staffAssignment || !(await assignmentCoversEvent(staffAssignment, eventId))) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot manage this event.");
  }
}

async function loadFestAndEvent(festId, eventId) {
  const fest = await FestModel.findById(festId).select("startsOn").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "This fest does not exist.");
  }

  const event = await EventModel.findById(eventId).select("eventName startsAt endsAt festId").lean();
  if (!event || String(event.festId) !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "This event does not exist.");
  }

  return { fest, event };
}

function toCheckpointSummary(checkpoint, checkpointTotals) {
  return {
    checkpointId: String(checkpoint._id),
    checkpointName: checkpoint.checkpointName,
    checkpointType: checkpoint.checkpointType,
    ...(checkpointTotals.get(String(checkpoint._id)) || {
      acceptedCount: 0,
      rejectedCount: 0,
      totalCount: 0,
    }),
  };
}

async function fetchLiveEventStaff(festId, eventId, { staffAssignment, isAdministrator } = {}) {
  const { fest, event } = await loadFestAndEvent(festId, eventId);
  await assertAssignmentCoversEvent(eventId, staffAssignment, isAdministrator);

  const generatedAt = new Date();
  const checkpoints = await loadAssociatedCheckpoints(festId, eventId);
  const checkpointIds = checkpoints.map((checkpoint) => checkpoint._id);
  const checkpointNames = new Map(
    checkpoints.map((checkpoint) => [String(checkpoint._id), checkpoint.checkpointName])
  );

  const { onShiftRows, upcomingRows } = await loadShiftRows(checkpointIds, generatedAt);
  const users = await loadUserDirectory([
    ...onShiftRows.map((shift) => shift.userId),
    ...upcomingRows.map((shift) => shift.userId),
  ]);

  const [checkpointTotals, volunteerTally, recentScans] = await Promise.all([
    summariseCheckpointScans(checkpointIds, fest.startsOn),
    summariseVolunteerScans(onShiftRows),
    buildRecentScans(checkpointIds, checkpointNames),
  ]);

  return {
    generatedAt: generatedAt.toISOString(),
    eventName: event.eventName,
    eventStartsAt: event.startsAt.toISOString(),
    eventEndsAt: event.endsAt.toISOString(),
    checkpoints: checkpoints.map((checkpoint) => toCheckpointSummary(checkpoint, checkpointTotals)),
    onShiftVolunteers: onShiftRows.map((shift) => ({
      ...toShiftIdentity(shift, users, checkpointNames),
      ...volunteerTally(shift, generatedAt),
    })),
    upcomingVolunteers: upcomingRows.map((shift) => ({
      ...toShiftIdentity(shift, users, checkpointNames),
      minutesUntilStart: Math.round((shift.startsAt.getTime() - generatedAt.getTime()) / 60000),
    })),
    recentScans,
  };
}

module.exports = { fetchLiveEventStaff };
