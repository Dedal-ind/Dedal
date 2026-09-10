const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ensureEventEntryCheckpoint } = require("./checkpoint-helpers");
const { recordAuditLog } = require("../services/audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { CHECKPOINT_TYPES } = require("../constants/scan-constants");
const {
  SHIFT_STATUSES,
  EARLY_ACCESS_WINDOW_HOURS,
  LATE_ACCESS_WINDOW_HOURS,
} = require("../constants/shift-constants");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/*
 * Auto-shift creation: assigning a volunteer used to be step 1 of a two-step
 * process the admin could forget (schedule a shift being step 2, without which
 * the volunteer's scanner never opens — the prompt-27 empty state). This makes
 * step 2 automatic with a sensible default window; the admin remains free to
 * edit or cancel the auto-created shift like any manual one — it is a floor,
 * not a ceiling.
 */

/* The default shift window around a start/end pair, via the two dials. */
function buildAccessWindow(startsAt, endsAt) {
  return {
    startsAt: new Date(startsAt.getTime() - EARLY_ACCESS_WINDOW_HOURS * MILLISECONDS_PER_HOUR),
    endsAt: new Date(endsAt.getTime() + LATE_ACCESS_WINDOW_HOURS * MILLISECONDS_PER_HOUR),
  };
}

/*
 * Idempotency: a shift already scheduled for this volunteer at this checkpoint
 * whose window OVERLAPS the proposed one means the slot is covered — whether it
 * was auto-created earlier or hand-tuned by an admin. Skip; never duplicate,
 * never overwrite.
 */
async function hasOverlappingScheduledShift(userId, checkpointId, window) {
  const existing = await VolunteerShiftModel.findOne({
    userId,
    checkpointId,
    status: SHIFT_STATUSES.SCHEDULED,
    startsAt: { $lte: window.endsAt },
    endsAt: { $gte: window.startsAt },
  })
    .select("_id")
    .lean();
  return Boolean(existing);
}

async function createOneAutoShift({ assignment, checkpoint, window, actorUserId, context }) {
  if (await hasOverlappingScheduledShift(assignment.userId, checkpoint._id, window)) {
    return null;
  }
  const shift = await VolunteerShiftModel.create({
    festId: assignment.festId,
    userId: assignment.userId,
    checkpointId: checkpoint._id,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    status: SHIFT_STATUSES.SCHEDULED,
    assignedByUserId: actorUserId,
  });
  // Traceable alongside STAFF_ASSIGNED: this row exists because of the
  // assignment, not because an admin scheduled it by hand.
  await recordAuditLog({
    actorUserId,
    festId: assignment.festId,
    action: AUDIT_ACTIONS.AUTO_SHIFT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.SHIFT,
    entityId: shift._id,
    afterState: {
      staffAssignmentId: String(assignment._id),
      checkpointId: String(checkpoint._id),
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
    },
    ...(context || {}),
  });
  return shift;
}

/*
 * Called after a VOLUNTEER assignment is created (never for coordinators —
 * coordinators have no shifts; their access is the assignment itself).
 *
 *   · Event-scoped assignment: one shift per covered event at that event's
 *     default event-entry checkpoint. An event without an entry checkpoint is
 *     skipped — there is nothing to stand at.
 *   · Fest-wide assignment (empty eventIds): ONE shift at the fest's main gate,
 *     spanning the fest's own dates.
 *
 * `events` are the already-loaded event documents named by the assignment.
 * Returns the created shifts (skips excluded) so callers and tests can see
 * exactly what was minted.
 */
async function createAutoShiftsForVolunteerAssignment({ assignment, fest, events, actorUserId, context }) {
  const createdShifts = [];

  if (events.length === 0) {
    const gateCheckpoint = await CheckpointModel.findOne({
      festId: assignment.festId,
      checkpointType: CHECKPOINT_TYPES.GATE,
      isActive: true,
    }).lean();
    if (!gateCheckpoint || !fest?.startsOn || !fest?.endsOn) {
      return createdShifts;
    }
    const shift = await createOneAutoShift({
      assignment,
      checkpoint: gateCheckpoint,
      window: buildAccessWindow(new Date(fest.startsOn), new Date(fest.endsOn)),
      actorUserId,
      context,
    });
    if (shift) {
      createdShifts.push(shift);
    }
    return createdShifts;
  }

  for (const event of events) {
    if (!event.startsAt || !event.endsAt) {
      continue;
    }
    /*
     * A DRAFT event has no door yet — publishing is what materialises one — so an
     * auto-shift used to be silently skipped for staff assigned during event
     * creation. Materialise the entry checkpoint here instead: the helper is
     * idempotent and publishing later finds this same row rather than a second.
     */
    let entryCheckpoint = await CheckpointModel.findOne({
      eventId: event._id,
      checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
      isActive: true,
    }).lean();
    if (!entryCheckpoint) {
      entryCheckpoint = await ensureEventEntryCheckpoint(
        assignment.festId,
        event._id,
        event.eventName
      );
    }
    // A deliberately deactivated door is not a place to stand: never revive it.
    if (!entryCheckpoint || entryCheckpoint.isActive === false) {
      continue;
    }
    const shift = await createOneAutoShift({
      assignment,
      checkpoint: entryCheckpoint,
      window: buildAccessWindow(new Date(event.startsAt), new Date(event.endsAt)),
      actorUserId,
      context,
    });
    if (shift) {
      createdShifts.push(shift);
    }
  }
  return createdShifts;
}

module.exports = { createAutoShiftsForVolunteerAssignment };
