const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS } = require("../constants/audit-log-constants");
const { SHIFT_STATUSES } = require("../constants/shift-constants");
const {
  serializeShift, serializeShifts, serializeMyShifts, recordShiftAudit,
} = require("../helpers/shift-serializer-helpers");
const {
  loadFestOrThrow, loadCheckpointForFestOrThrow, assertUserIsActiveVolunteer, parseShiftWindow,
  coordinatorCoverageSet, assertCheckpointAccessible, loadShiftInFestOrThrow, applyStatusFilter,
  buildFestShiftQuery, loadActiveFestVolunteers,
} = require("../helpers/shift-access-helpers");

async function createShift({ festId, userId, checkpointId, startsAt, endsAt, actor }) {
  await loadFestOrThrow(festId);
  await loadCheckpointForFestOrThrow(festId, checkpointId);
  assertCheckpointAccessible(await coordinatorCoverageSet(festId, actor), checkpointId);
  await assertUserIsActiveVolunteer(festId, userId);
  const window = parseShiftWindow(startsAt, endsAt);

  const created = await VolunteerShiftModel.create({
    festId, userId, checkpointId,
    startsAt: window.startsAt, endsAt: window.endsAt,
    status: SHIFT_STATUSES.SCHEDULED, assignedByUserId: actor.userId,
  });
  const dto = await serializeShift(created.toObject());
  await recordShiftAudit(AUDIT_ACTIONS.SHIFT_CREATED, actor, festId, created._id, { afterState: dto });
  return { shift: dto };
}

async function listShiftsForFest({ festId, actor, filters = {} }) {
  await loadFestOrThrow(festId);
  const coverage = await coordinatorCoverageSet(festId, actor);
  if (coverage && coverage.size === 0) {
    return { shifts: [] };
  }
  const shifts = await VolunteerShiftModel.find(buildFestShiftQuery(festId, filters, coverage))
    .sort({ startsAt: 1 })
    .lean();
  return { shifts: await serializeShifts(shifts) };
}

async function getShiftById({ festId, shiftId, actor }) {
  await loadFestOrThrow(festId);
  const shift = await loadShiftInFestOrThrow(festId, shiftId);
  assertCheckpointAccessible(await coordinatorCoverageSet(festId, actor), shift.checkpointId);
  return { shift: await serializeShift(shift) };
}

async function updateShift({ festId, shiftId, actor, updates }) {
  await loadFestOrThrow(festId);
  const shift = await loadShiftInFestOrThrow(festId, shiftId);
  if (shift.status === SHIFT_STATUSES.CANCELLED) {
    throw new ApplicationError(400, ERROR_CODES.SHIFT_ALREADY_CANCELLED, "This shift is already cancelled.");
  }
  const coverage = await coordinatorCoverageSet(festId, actor);
  assertCheckpointAccessible(coverage, shift.checkpointId);
  const nextCheckpointId = updates.checkpointId || shift.checkpointId;
  if (updates.checkpointId) {
    await loadCheckpointForFestOrThrow(festId, updates.checkpointId);
    assertCheckpointAccessible(coverage, updates.checkpointId);
  }
  const window = parseShiftWindow(updates.startsAt || shift.startsAt, updates.endsAt || shift.endsAt);

  const beforeState = await serializeShift(shift);
  const updated = await VolunteerShiftModel.findByIdAndUpdate(
    shiftId,
    { checkpointId: nextCheckpointId, startsAt: window.startsAt, endsAt: window.endsAt },
    { new: true }
  ).lean();
  const afterState = await serializeShift(updated);
  await recordShiftAudit(AUDIT_ACTIONS.SHIFT_UPDATED, actor, festId, updated._id, { beforeState, afterState });
  return { shift: afterState };
}

async function cancelShift({ festId, shiftId, actor, cancellationReason }) {
  await loadFestOrThrow(festId);
  const shift = await loadShiftInFestOrThrow(festId, shiftId);
  assertCheckpointAccessible(await coordinatorCoverageSet(festId, actor), shift.checkpointId);
  if (shift.status === SHIFT_STATUSES.CANCELLED) {
    return { shift: await serializeShift(shift) };
  }
  const updated = await VolunteerShiftModel.findByIdAndUpdate(
    shiftId,
    {
      status: SHIFT_STATUSES.CANCELLED, cancelledAt: new Date(),
      cancelledByUserId: actor.userId, cancellationReason: cancellationReason || null,
    },
    { new: true }
  ).lean();
  const dto = await serializeShift(updated);
  await recordShiftAudit(AUDIT_ACTIONS.SHIFT_CANCELLED, actor, festId, updated._id, {
    beforeState: { status: shift.status }, afterState: dto,
  });
  return { shift: dto };
}

async function listMyShifts({ actor, filters = {} }) {
  const query = { userId: actor.userId };
  if (filters.festId) {
    query.festId = filters.festId;
  }
  applyStatusFilter(query, filters.status);
  const shifts = await VolunteerShiftModel.find(query).sort({ startsAt: 1 }).lean();
  return { shifts: await serializeMyShifts(shifts) };
}

async function listFestVolunteers({ festId }) {
  await loadFestOrThrow(festId);
  return { volunteers: await loadActiveFestVolunteers(festId) };
}

module.exports = {
  createShift,
  listShiftsForFest,
  getShiftById,
  updateShift,
  cancelShift,
  listMyShifts,
  listFestVolunteers,
};
