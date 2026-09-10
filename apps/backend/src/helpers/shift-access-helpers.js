const mongoose = require("mongoose");
const { FestModel } = require("../models/fest-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { SHIFT_STATUSES } = require("../constants/shift-constants");
const { assignmentCoversCheckpoint } = require("./assignment-coverage-helpers");

const STATUS_ALL = "all";

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).lean()
    : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

// A checkpoint that does not exist is a 404; one that exists but sits in another fest is a 400.
async function loadCheckpointForFestOrThrow(festId, checkpointId) {
  const checkpoint = mongoose.Types.ObjectId.isValid(checkpointId)
    ? await CheckpointModel.findById(checkpointId).lean()
    : null;
  if (!checkpoint) {
    throw new ApplicationError(404, ERROR_CODES.CHECKPOINT_NOT_FOUND, "Checkpoint not found.");
  }
  if (String(checkpoint.festId) !== String(festId)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.SHIFT_CHECKPOINT_NOT_IN_FEST,
      "That checkpoint does not belong to this fest."
    );
  }
  return checkpoint;
}

async function assertUserIsActiveVolunteer(festId, userId) {
  const user = mongoose.Types.ObjectId.isValid(userId)
    ? await UserModel.findById(userId).select("_id").lean()
    : null;
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  const volunteerAssignment = await StaffAssignmentModel.findOne({
    userId,
    festId,
    role: STAFF_ROLES.VOLUNTEER,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();
  if (!volunteerAssignment) {
    throw new ApplicationError(
      400,
      ERROR_CODES.SHIFT_USER_NOT_VOLUNTEER,
      "That person is not an active volunteer for this fest."
    );
  }
}

// Overlaps are allowed; the only window rule is start < end (and both parseable).
function parseShiftWindow(startsAtInput, endsAtInput) {
  const startsAt = new Date(startsAtInput);
  const endsAt = new Date(endsAtInput);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    startsAt.getTime() >= endsAt.getTime()
  ) {
    throw new ApplicationError(
      400,
      ERROR_CODES.SHIFT_INVALID_WINDOW,
      "Set a valid window: the shift must end after it starts."
    );
  }
  return { startsAt, endsAt };
}

/*
 * The checkpoint ids a coordinator may act on, derived from their assignment's
 * event coverage. Administrators return null — "every checkpoint", no scoping.
 */
async function coordinatorCoverageSet(festId, actor) {
  if (actor.isAdministrator) {
    return null;
  }
  const checkpoints = await CheckpointModel.find({ festId })
    .select("_id eventId checkpointType")
    .lean();
  const covered = await Promise.all(
    checkpoints.map((checkpoint) => assignmentCoversCheckpoint(actor.assignment, checkpoint))
  );
  return new Set(
    checkpoints
      .filter((checkpoint, index) => covered[index])
      .map((checkpoint) => String(checkpoint._id))
  );
}

function assertCheckpointAccessible(coverageSet, checkpointId) {
  if (coverageSet && !coverageSet.has(String(checkpointId))) {
    throw new ApplicationError(403, ERROR_CODES.FORBIDDEN, "You cannot manage this checkpoint's shifts.");
  }
}

async function loadShiftInFestOrThrow(festId, shiftId) {
  const shift = mongoose.Types.ObjectId.isValid(shiftId)
    ? await VolunteerShiftModel.findById(shiftId).lean()
    : null;
  if (!shift || String(shift.festId) !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.SHIFT_NOT_FOUND, "Shift not found.");
  }
  return shift;
}

// Default status is scheduled; the special value "all" omits the status filter.
function applyStatusFilter(query, status) {
  if (status === STATUS_ALL) {
    return;
  }
  query.status = status || SHIFT_STATUSES.SCHEDULED;
}

/*
 * The fest-listing query from the filters, narrowed to a coordinator's coverage.
 * A checkpoint filter outside coverage yields a query that matches nothing. Time
 * bounds test any overlap with the window: startsAt <= to AND endsAt >= from.
 */
function buildFestShiftQuery(festId, filters, coverageSet) {
  const query = { festId };
  applyStatusFilter(query, filters.status);
  if (filters.userId) {
    query.userId = filters.userId;
  }
  if (filters.checkpointId && coverageSet && !coverageSet.has(String(filters.checkpointId))) {
    query.checkpointId = null;
  } else if (filters.checkpointId) {
    query.checkpointId = filters.checkpointId;
  } else if (coverageSet) {
    query.checkpointId = { $in: [...coverageSet] };
  }
  if (filters.to) {
    query.startsAt = { $lte: new Date(filters.to) };
  }
  if (filters.from) {
    query.endsAt = { $gte: new Date(filters.from) };
  }
  return query;
}

/*
 * The fest's active volunteers for the assignee picker: { userId, fullName,
 * emailAddress, collegeName }, sorted by name. Both admins and coordinators see
 * the full list — a shift can schedule any fest volunteer at any checkpoint.
 */
async function loadActiveFestVolunteers(festId) {
  const assignments = await StaffAssignmentModel.find({
    festId,
    role: STAFF_ROLES.VOLUNTEER,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId")
    .lean();
  const users = await UserModel.find({ _id: { $in: assignments.map((row) => row.userId) } })
    .select("fullName emailAddress collegeId")
    .lean();
  const colleges = await CollegeModel.find({
    _id: { $in: users.map((user) => user.collegeId).filter(Boolean) },
  })
    .select("commonName")
    .lean();
  const collegeNameById = new Map(colleges.map((college) => [String(college._id), college.commonName]));
  return users
    .map((user) => ({
      userId: String(user._id),
      fullName: user.fullName,
      emailAddress: user.emailAddress,
      collegeName: user.collegeId ? collegeNameById.get(String(user.collegeId)) || null : null,
    }))
    .sort((first, second) => String(first.fullName || "").localeCompare(String(second.fullName || "")));
}

module.exports = {
  loadFestOrThrow,
  loadCheckpointForFestOrThrow,
  assertUserIsActiveVolunteer,
  parseShiftWindow,
  coordinatorCoverageSet,
  assertCheckpointAccessible,
  loadShiftInFestOrThrow,
  applyStatusFilter,
  buildFestShiftQuery,
  loadActiveFestVolunteers,
};
