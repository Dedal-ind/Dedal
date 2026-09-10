const { CollegeModel } = require("../models/college-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The colleges a user may administer. A staff assignment can outlive the college
 * it points at (nothing cascades on delete), so the college lookup is what
 * decides the result — a dangling assignment simply contributes no college.
 */
async function listCollegesUserAdministers(userId) {
  /*
   * A platformAdmin administers every college. Their assignment deliberately
   * carries no collegeId — the role is platform-scoped — so the query below
   * returned nothing for them and Create Fest showed "You do not administer any
   * college yet" to the one account that administers all of them.
   *
   * Answered here rather than in the UI: assertAdministrator already passes a
   * platformAdmin on the write path, so a dropdown that hid those colleges was
   * disagreeing with what the server would actually accept.
   */
  const isPlatformAdmin = await StaffAssignmentModel.exists({
    userId,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });

  if (isPlatformAdmin) {
    const allColleges = await CollegeModel.find().sort({ commonName: 1 });
    return allColleges.map((college) => college.toJSON());
  }

  const assignments = await StaffAssignmentModel.find({
    userId,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    collegeId: { $ne: null },
  })
    .select("collegeId")
    .lean();

  if (assignments.length === 0) {
    return [];
  }

  const collegeIds = assignments.map((assignment) => assignment.collegeId);
  const colleges = await CollegeModel.find({ _id: { $in: collegeIds } }).sort({
    commonName: 1,
  });

  return colleges.map((college) => college.toJSON());
}

/*
 * The verified colleges a participant can pick during profile completion.
 * Both directory ("reference") and tenant ("active") colleges belong here —
 * only "inactive" is hidden. Active tenants sort first, then by commonName.
 */
async function listVerifiedColleges(city) {
  const filter = { isVerified: true, status: { $ne: "inactive" } };
  if (city) {
    // Case-insensitive exact match so ?city=bangalore still finds "Bangalore".
    filter.city = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  }
  const colleges = await CollegeModel.find(filter)
    .select("collegeName commonName city status")
    .sort({ status: 1, commonName: 1 });
  return colleges.map((college) => college.toJSON());
}

/*
 * College self-signup. Anyone signed in can register a college; it starts UNVERIFIED
 * (invisible to participants) and the registering user becomes its administrator in
 * the same breath. The platform owner reviews and verifies it before it goes live —
 * so a college and its first admin are born together, gated by one approval.
 */
async function registerCollege(userId, attributes) {
  const college = await CollegeModel.create({
    collegeName: attributes.collegeName,
    commonName: attributes.commonName,
    city: attributes.city,
    state: attributes.state,
    aisheCode: attributes.aisheCode || undefined,
    contactEmail: attributes.contactEmail || undefined,
    isVerified: false,
    createdByUserId: userId,
  });

  await StaffAssignmentModel.create({
    userId,
    collegeId: college._id,
    festId: null,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    assignedByUserId: userId,
  });

  return college.toJSON();
}

/* Every college, verified and pending, newest-pending first — the owner's queue. */
async function listAllColleges() {
  const colleges = await CollegeModel.find({})
    .sort({ isVerified: 1, createdAt: -1 })
    .populate("createdByUserId", "fullName emailAddress");
  return colleges.map((college) => college.toJSON());
}

async function findCollegeOrThrow(collegeId) {
  const college = await CollegeModel.findById(collegeId);
  if (!college) {
    throw new ApplicationError(404, ERROR_CODES.COLLEGE_NOT_FOUND, "College not found.");
  }
  return college;
}

/* The owner's approval: flip a pending college live so participants can pick it. */
async function setCollegeVerified(collegeId, isVerified) {
  const college = await findCollegeOrThrow(collegeId);
  college.isVerified = isVerified;
  await college.save();
  return college.toJSON();
}

module.exports = {
  listCollegesUserAdministers,
  listVerifiedColleges,
  registerCollege,
  listAllColleges,
  setCollegeVerified,
};
