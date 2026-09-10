const mongoose = require("mongoose");

const { UserModel } = require("../models/user-model");
const { EventModel } = require("../models/event-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

/*
 * An invitee who has never signed in still needs a userId to hang the assignment
 * on. The placeholder carries nothing but the address: emailVerifiedAt stays null
 * until they prove control of the mailbox, and verifyOtp's upsert finds this row
 * rather than inserting a second one.
 *
 * The address is already lowercased by the validator, which is what makes the
 * unique index find the existing user rather than collide with it.
 */
function isDuplicateEmailAddress(error) {
  return error?.code === 11000 && Object.keys(error.keyPattern || {}).includes("emailAddress");
}

async function findOrCreateUserByEmailAddress(emailAddress) {
  const existingUser = await UserModel.findOne({ emailAddress });
  if (existingUser) {
    return { user: existingUser, wasCreated: false };
  }
  try {
    return { user: await UserModel.create({ emailAddress }), wasCreated: true };
  } catch (error) {
    // Two concurrent calls for the same new address both read null and both
    // insert; the loser trips the unique emailAddress index. Re-read and return
    // the winner's row as the loser — wasCreated false so a create-only side
    // effect (welcome email, first-time audit) never double-fires. Any other
    // duplicate-key collision, and any non-11000 error, propagates untouched.
    if (!isDuplicateEmailAddress(error)) throw error;
    return { user: await UserModel.findOne({ emailAddress }), wasCreated: false };
  }
}

/*
 * Every named event must belong to this fest. An event from another fest is
 * reported as missing rather than as forbidden, so the endpoint cannot be used
 * to discover which event ids exist elsewhere.
 */
async function loadFestEventsOrThrow(festId, eventIds) {
  if (eventIds.length === 0) {
    return [];
  }

  const events = await EventModel.find({ _id: { $in: eventIds }, festId });

  if (events.length !== new Set(eventIds.map(String)).size) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.", {
      festId: String(festId),
    });
  }
  return events;
}

// Active before revoked; coordinator before volunteer; newest first inside a tie.
const STATUS_RANK = { [STAFF_ASSIGNMENT_STATUSES.ACTIVE]: 0, [STAFF_ASSIGNMENT_STATUSES.REVOKED]: 1 };
const ROLE_RANK = { [STAFF_ROLES.COORDINATOR]: 0, [STAFF_ROLES.VOLUNTEER]: 1 };

function compareAssignments(first, second) {
  const byStatus = (STATUS_RANK[first.status] ?? 2) - (STATUS_RANK[second.status] ?? 2);
  if (byStatus !== 0) {
    return byStatus;
  }
  const byRole = (ROLE_RANK[first.role] ?? 2) - (ROLE_RANK[second.role] ?? 2);
  if (byRole !== 0) {
    return byRole;
  }
  return second.createdAt.getTime() - first.createdAt.getTime();
}

function isDuplicateAssignmentError(error) {
  return error?.code === 11000 && Object.keys(error.keyPattern || {}).includes("userId");
}

/*
 * The unique index is filtered to active rows, so a revoked grant never collides
 * and the insert is what decides. The live row is looked up only once Mongo has
 * refused, which is why naming it here cannot race a concurrent revoke.
 */
async function buildAlreadyExistsError(userId, festId, payload) {
  const existing = await StaffAssignmentModel.findOne({
    userId,
    festId,
    role: payload.role,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();

  return new ApplicationError(
    409,
    ERROR_CODES.ASSIGNMENT_ALREADY_EXISTS,
    "This person already holds that role for this fest.",
    {
      emailAddress: payload.emailAddress,
      role: payload.role,
      existingAssignmentId: existing ? existing._id.toString() : null,
    }
  );
}

function toObjectId(candidateId) {
  return mongoose.Types.ObjectId.isValid(candidateId)
    ? new mongoose.Types.ObjectId(candidateId)
    : null;
}

module.exports = {
  findOrCreateUserByEmailAddress,
  loadFestEventsOrThrow,
  compareAssignments,
  isDuplicateAssignmentError,
  buildAlreadyExistsError,
  toObjectId,
};
