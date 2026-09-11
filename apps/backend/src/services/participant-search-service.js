const mongoose = require("mongoose");

const { UserModel } = require("../models/user-model");
const { PassModel } = require("../models/pass-model");
const { FestModel } = require("../models/fest-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { hasAdministratorAuthority } = require("../helpers/administrator-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

const RESULT_LIMIT = 10;
const OPERATING_ROLES = [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER];

// Escaped so a name containing a regex metacharacter is matched literally.
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId) ? await FestModel.findById(festId).lean() : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

/* Only staff of the fest — an administrator of its host college, or an active coordinator/volunteer — may search its participants. */
async function assertStaffOfFest(userId, fest) {
  if (await hasAdministratorAuthority(userId, fest.hostCollegeId)) {
    return;
  }
  const staffAssignment = await StaffAssignmentModel.findOne({
    userId,
    festId: fest._id,
    role: { $in: OPERATING_ROLES },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
  if (!staffAssignment) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot search this fest.");
  }
}

function formatParticipant(user, passByUserId) {
  const college = user.collegeId;
  return {
    id: user._id.toString(),
    fullName: user.fullName || null,
    usn: user.usn || null,
    collegeName: college && college.commonName ? college.commonName : null,
    photoUrl: user.photoUrl || null,
    passId: passByUserId.get(user._id.toString()) || null,
  };
}

/*
 * Searches the fest's own pass-holders by name prefix or USN prefix, so a
 * volunteer whose QR and backup-code fallbacks both fail can still find the
 * participant. Results carry the passId for this fest, which the scan-by-pass
 * flow consumes — the backupCode itself never leaves the server.
 */
async function searchParticipants(userId, rawQuery) {
  const query = typeof rawQuery.query === "string" ? rawQuery.query.trim() : "";
  if (query.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "A search query is required.", {
      query: "is required",
    });
  }

  const fest = await loadFestOrThrow(rawQuery.festId);
  await assertStaffOfFest(userId, fest);

  const passes = await PassModel.find({ festId: fest._id }).select("userId backupCode").lean();
  const passByUserId = new Map(passes.map((pass) => [pass.userId.toString(), pass._id.toString()]));
  if (passByUserId.size === 0) {
    return [];
  }

  const namePrefix = new RegExp(`^${escapeRegularExpression(query)}`, "i");
  const usnPrefix = new RegExp(`^${escapeRegularExpression(query.toUpperCase())}`);
  /*
   * Named fields, for the same reason as buildParticipantSummary: this is a
   * volunteer-reachable search, and formatParticipant below only ever reads
   * these. Loading whole user documents to publish four of their fields put the
   * rest one careless edit away from the response.
   */
  const users = await UserModel.find({
    _id: { $in: passes.map((pass) => pass.userId) },
    $or: [{ fullName: namePrefix }, { usn: usnPrefix }],
  })
    .select("fullName usn collegeId")
    .limit(RESULT_LIMIT)
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();

  return users.map((user) => formatParticipant(user, passByUserId));
}

module.exports = { searchParticipants };
