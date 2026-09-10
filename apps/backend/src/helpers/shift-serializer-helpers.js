const { UserModel } = require("../models/user-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { FestModel } = require("../models/fest-model");
const { recordAuditLog } = require("../services/audit-log-service");
const { AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

function toIso(dateValue) {
  return dateValue ? new Date(dateValue).toISOString() : null;
}

function toIdString(value) {
  return value ? String(value) : null;
}

/*
 * The exact shape shift-api.js documents. Reference docs (volunteer / checkpoint /
 * assignedBy / cancelledBy) are pre-fetched by the caller to avoid N+1; any that is
 * missing degrades its name/email fields to null while the DTO stays valid.
 */
function toShiftDto(shift, { volunteer, checkpoint, assignedBy, cancelledBy } = {}) {
  return {
    shiftId: String(shift._id),
    festId: String(shift.festId),
    userId: String(shift.userId),
    userFullName: volunteer ? volunteer.fullName : null,
    userEmailAddress: volunteer ? volunteer.emailAddress : null,
    checkpointId: String(shift.checkpointId),
    checkpointName: checkpoint ? checkpoint.checkpointName : null,
    startsAt: toIso(shift.startsAt),
    endsAt: toIso(shift.endsAt),
    status: shift.status,
    assignedByUserId: toIdString(shift.assignedByUserId),
    assignedByFullName: assignedBy ? assignedBy.fullName : null,
    cancellationReason: shift.cancellationReason || null,
    cancelledAt: toIso(shift.cancelledAt),
    cancelledByUserId: toIdString(shift.cancelledByUserId),
    createdAt: toIso(shift.createdAt),
    updatedAt: toIso(shift.updatedAt),
  };
}

/* One find per referenced collection, so a list of N shifts costs two queries. */
async function loadShiftReferenceMaps(shifts) {
  const userIds = new Set();
  const checkpointIds = new Set();
  for (const shift of shifts) {
    userIds.add(String(shift.userId));
    userIds.add(String(shift.assignedByUserId));
    if (shift.cancelledByUserId) userIds.add(String(shift.cancelledByUserId));
    checkpointIds.add(String(shift.checkpointId));
  }
  const [users, checkpoints] = await Promise.all([
    UserModel.find({ _id: { $in: [...userIds] } }).select("fullName emailAddress").lean(),
    CheckpointModel.find({ _id: { $in: [...checkpointIds] } }).select("checkpointName").lean(),
  ]);
  return {
    usersById: new Map(users.map((user) => [String(user._id), user])),
    checkpointsById: new Map(checkpoints.map((checkpoint) => [String(checkpoint._id), checkpoint])),
  };
}

function dtoFromMaps(shift, { usersById, checkpointsById }) {
  return toShiftDto(shift, {
    volunteer: usersById.get(String(shift.userId)),
    checkpoint: checkpointsById.get(String(shift.checkpointId)),
    assignedBy: usersById.get(String(shift.assignedByUserId)),
    cancelledBy: shift.cancelledByUserId ? usersById.get(String(shift.cancelledByUserId)) : null,
  });
}

// /shifts/mine denormalizes the fest onto each shift so the volunteer's home needs no extra fetch.
function withFestFields(dto, fest) {
  return {
    ...dto,
    festName: fest ? fest.festName : null,
    festStartsOn: toIso(fest && fest.startsOn),
    festEndsOn: toIso(fest && fest.endsOn),
  };
}

/* Serialize one shift doc (batch-loads its references). */
async function serializeShift(shift) {
  return dtoFromMaps(shift, await loadShiftReferenceMaps([shift]));
}

/* Serialize a list of shift docs with two reference queries total. */
async function serializeShifts(shifts) {
  const maps = await loadShiftReferenceMaps(shifts);
  return shifts.map((shift) => dtoFromMaps(shift, maps));
}

/* The /shifts/mine list: shift DTOs enriched with their fest's name and dates. */
async function serializeMyShifts(shifts) {
  const maps = await loadShiftReferenceMaps(shifts);
  const festIds = [...new Set(shifts.map((shift) => String(shift.festId)))];
  const fests = await FestModel.find({ _id: { $in: festIds } }).select("festName startsOn endsOn").lean();
  const festsById = new Map(fests.map((fest) => [String(fest._id), fest]));
  return shifts.map((shift) =>
    withFestFields(dtoFromMaps(shift, maps), festsById.get(String(shift.festId)))
  );
}

/* Every shift mutation records one guarded audit row (recordAuditLog never throws). */
async function recordShiftAudit(action, actor, festId, entityId, states = {}) {
  await recordAuditLog({
    actorUserId: actor.userId,
    festId,
    action,
    entityType: AUDIT_ENTITY_TYPES.SHIFT,
    entityId,
    beforeState: states.beforeState || null,
    afterState: states.afterState || null,
    ...(actor.context || {}),
  });
}

module.exports = {
  toIso,
  toShiftDto,
  loadShiftReferenceMaps,
  dtoFromMaps,
  withFestFields,
  serializeShift,
  serializeShifts,
  serializeMyShifts,
  recordShiftAudit,
};
