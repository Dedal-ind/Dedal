const mongoose = require("mongoose");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { FestModel } = require("../models/fest-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { assignmentCoversCheckpoint } = require("../helpers/assignment-coverage-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  CHECKPOINT_TYPES,
  CHECKPOINT_DIRECTION_MODES,
} = require("../constants/scan-constants");

const OPERATING_ROLES = [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER, STAFF_ROLES.ADMINISTRATOR];

// A null bound is open-ended: an assignment naming no event has no window to fail.
function isWithinWindow(assignment, now) {
  if (assignment.validFrom && now < assignment.validFrom) {
    return false;
  }
  if (assignment.validTo && now > assignment.validTo) {
    return false;
  }
  return true;
}

/*
 * A coordinator assigned to a VERTICAL covers its sub-events, and the scan gate
 * (assignmentCoversEvent) honours that by walking the parent chain in JS. This
 * query did not: a raw `{ eventId: { $in: assignment.eventIds } }` matches only
 * the events NAMED on the assignment, so a vertical coordinator was authorised
 * to scan a child event's door but never saw that door in their checkpoint list.
 * Expanding to descendants here makes the two agree.
 */
async function expandToDescendantEventIds(eventIds) {
  const scoped = (eventIds ?? []).map(String);
  if (scoped.length === 0) {
    return [];
  }
  const { EventModel } = require("../models/event-model");
  const seen = new Set(scoped);
  let frontier = scoped;
  // Depth cap mirrors ANCESTOR_WALK_MAX_DEPTH in assignment-coverage-helpers.
  for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
    const children = await EventModel.find({ parentEventId: { $in: frontier } })
      .select("_id")
      .lean();
    frontier = children.map((child) => String(child._id)).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  return [...seen].map((id) => new mongoose.Types.ObjectId(id));
}

/*
 * Each in-window assignment contributes a checkpoint filter. A coordinator or
 * volunteer scoped to specific events sees those event doors plus the fest gate;
 * one scoped to the whole fest (empty eventIds) sees every checkpoint in it. An
 * administrator is college-scoped, so their fests are resolved first and every
 * checkpoint under them is covered.
 */
async function buildCheckpointFilters(assignments, now) {
  const filters = [];
  const administeredCollegeIds = [];

  for (const assignment of assignments.filter((candidate) => isWithinWindow(candidate, now))) {
    if (assignment.role === STAFF_ROLES.ADMINISTRATOR) {
      if (assignment.collegeId) administeredCollegeIds.push(assignment.collegeId);
      continue;
    }
    if (!assignment.festId) continue;
    const scopedEventIds = await expandToDescendantEventIds(assignment.eventIds);
    const assignmentFilter =
      !assignment.eventIds || assignment.eventIds.length === 0
        ? { festId: assignment.festId }
        : {
            festId: assignment.festId,
            $or: [{ eventId: { $in: scopedEventIds } }, { eventId: null }],
          };
    // No per-offer narrowing here: offer scoping on an assignment was reverted
    // (only volunteers scan offers, and a shift already names one checkpoint).
    filters.push(assignmentFilter);
  }

  if (administeredCollegeIds.length > 0) {
    const fests = await FestModel.find({ hostCollegeId: { $in: administeredCollegeIds } })
      .select("_id")
      .lean();
    if (fests.length > 0) {
      filters.push({ festId: { $in: fests.map((fest) => fest._id) } });
    }
  }

  return filters;
}

function formatCheckpoint(checkpoint) {
  return {
    id: checkpoint._id.toString(),
    checkpointName: checkpoint.checkpointName,
    checkpointType: checkpoint.checkpointType,
    directionMode: checkpoint.directionMode,
    festId: checkpoint.festId ? checkpoint.festId._id.toString() : null,
    festName: checkpoint.festId ? checkpoint.festId.festName : null,
    eventId: checkpoint.eventId ? checkpoint.eventId._id.toString() : null,
    eventName: checkpoint.eventId ? checkpoint.eventId.eventName : null,
  };
}

/* The checkpoints the caller may operate right now, deduplicated across every assignment. */
async function listMyActiveCheckpoints(userId) {
  const now = new Date();
  const assignments = await StaffAssignmentModel.find({
    userId,
    role: { $in: OPERATING_ROLES },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();

  const filters = await buildCheckpointFilters(assignments, now);
  if (filters.length === 0) {
    return [];
  }

  const checkpoints = await CheckpointModel.find({ isActive: true, $or: filters })
    .populate("festId", "festName bannerImageUrl")
    .populate("eventId", "eventName")
    .sort({ checkpointType: 1, checkpointName: 1 })
    .lean();

  return checkpoints.map(formatCheckpoint);
}

/*
 * Every checkpoint in a fest, for the shift checkpoint picker. An administrator
 * sees all; a coordinator sees only the checkpoints their assignment covers. The
 * shape ({ checkpointId, name, ... }) matches what shift-api.js's picker reads.
 */
async function listFestCheckpoints(festId, actor) {
  const checkpoints = await CheckpointModel.find({ festId }).sort({ checkpointName: 1 }).lean();
  let visible = checkpoints;
  if (!actor.isAdministrator) {
    const covered = await Promise.all(
      checkpoints.map((checkpoint) => assignmentCoversCheckpoint(actor.assignment, checkpoint))
    );
    visible = checkpoints.filter((checkpoint, index) => covered[index]);
  }
  return visible.map((checkpoint) => ({
    checkpointId: String(checkpoint._id),
    name: checkpoint.checkpointName,
    checkpointType: checkpoint.checkpointType,
    eventId: checkpoint.eventId ? String(checkpoint.eventId) : null,
    // Additive fields for the admin offer-checkpoints panel.
    offerId: checkpoint.offerId ? String(checkpoint.offerId) : null,
    isActive: checkpoint.isActive !== false,
  }));
}

/*
 * Admin-created offer counters beyond the auto-materialised default ("Food
 * Counter B"). The offerId must belong to this fest, or the checkpoint would be
 * a claim point for an offer that cannot exist here.
 */
async function createOfferCheckpoint(festId, { offerId, checkpointName }) {
  const fest = await FestModel.findById(festId).select("offers").lean();
  const offerExists = (fest?.offers ?? []).some((offer) => String(offer._id) === String(offerId));
  if (!offerExists) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CHECKPOINT_OFFER_MISMATCH,
      "That offer does not belong to this fest."
    );
  }
  const checkpoint = await CheckpointModel.create({
    festId,
    eventId: null,
    offerId,
    checkpointName,
    checkpointType: CHECKPOINT_TYPES.OFFER,
    directionMode: CHECKPOINT_DIRECTION_MODES.IN_ONLY,
    isActive: true,
  });
  return checkpoint.toJSON();
}

/*
 * Rename or (de)activate a checkpoint. There is deliberately NO delete — scans
 * are append-only and each carries checkpointId, so removal is always a PATCH
 * to isActive: false. offerId/festId are frozen: a checkpoint that was "food
 * dorm" cannot become "accommodation dorm" without silently relabelling every
 * scan already logged against it.
 */
async function updateCheckpoint(festId, checkpointId, changes) {
  if (changes.offerId !== undefined || changes.festId !== undefined || changes.eventId !== undefined) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CHECKPOINT_IDENTITY_FROZEN,
      "A checkpoint's fest, event and offer cannot be changed."
    );
  }
  const checkpoint = mongoose.Types.ObjectId.isValid(checkpointId)
    ? await CheckpointModel.findOne({ _id: checkpointId, festId })
    : null;
  if (!checkpoint) {
    throw new ApplicationError(404, ERROR_CODES.CHECKPOINT_NOT_FOUND, "Checkpoint not found.");
  }
  if (typeof changes.checkpointName === "string" && changes.checkpointName.trim().length > 0) {
    checkpoint.checkpointName = changes.checkpointName.trim();
  }
  if (typeof changes.isActive === "boolean") {
    checkpoint.isActive = changes.isActive;
  }
  await checkpoint.save();
  return checkpoint.toJSON();
}

/*
 * Tells the volunteers on duty at a checkpoint to start scanning.
 *
 * "On duty" is the SHIFT, not the assignment: a volunteer assigned to the fest
 * but not scheduled here has nothing to start. One email each, fire-and-forget
 * per recipient (sendMailQuietly never throws), so one dead address cannot stop
 * the rest of the gate team being told.
 */
async function alertCheckpointVolunteers(festId, checkpointId, message, actorUserId, context = {}) {
  const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
  const { UserModel } = require("../models/user-model");
  const { FestModel } = require("../models/fest-model");
  const { SHIFT_STATUSES } = require("../constants/shift-constants");
  const { sendCheckpointAlertEmail } = require("./email-service");
  const { recordAuditLog } = require("./audit-log-service");
  const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

  const checkpoint = await CheckpointModel.findOne({ _id: checkpointId, festId }).lean();
  if (!checkpoint) {
    throw new ApplicationError(404, ERROR_CODES.CHECKPOINT_NOT_FOUND, "Checkpoint not found.");
  }
  const fest = await FestModel.findById(festId).select("festName").lean();

  const now = new Date();
  const shifts = await VolunteerShiftModel.find({
    festId,
    checkpointId: checkpoint._id,
    status: SHIFT_STATUSES.SCHEDULED,
    endsAt: { $gte: now },
  })
    .select("userId")
    .lean();
  const volunteerIds = [...new Set(shifts.map((shift) => String(shift.userId)))];
  const volunteers = await UserModel.find({ _id: { $in: volunteerIds } })
    .select("emailAddress")
    .lean();

  const defaultMessage = `Scanning is now active at ${checkpoint.checkpointName}. Please begin check-in.`;
  let notifiedCount = 0;
  for (const volunteer of volunteers) {
    if (!volunteer.emailAddress) {
      continue;
    }
    await sendCheckpointAlertEmail({
      emailAddress: volunteer.emailAddress,
      checkpointName: checkpoint.checkpointName,
      festName: fest?.festName ?? "",
      festBannerImageUrl: fest?.bannerImageUrl ?? null,
      message: message?.trim() || defaultMessage,
    });
    notifiedCount += 1;
  }

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.CHECKPOINT_VOLUNTEERS_ALERTED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: checkpoint._id,
    afterState: { checkpointName: checkpoint.checkpointName, notifiedCount },
    ...context,
  });
  return { notifiedCount, checkpointName: checkpoint.checkpointName };
}

module.exports = {
  alertCheckpointVolunteers, listMyActiveCheckpoints, listFestCheckpoints, createOfferCheckpoint, updateCheckpoint };
