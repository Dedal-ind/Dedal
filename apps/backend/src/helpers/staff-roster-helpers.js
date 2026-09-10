const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { EventModel } = require("../models/event-model");
const { STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

function toIso(dateValue) {
  return dateValue ? new Date(dateValue).toISOString() : null;
}

// Most permissive wins when a person holds several assignments: active > upcoming > expired > revoked.
const STATUS_RANK = { active: 3, upcoming: 2, expired: 1, revoked: 0 };

function assignmentState(assignment, now) {
  if (assignment.status === STAFF_ASSIGNMENT_STATUSES.REVOKED) {
    return "revoked";
  }
  if (assignment.validFrom && now < assignment.validFrom) {
    return "upcoming";
  }
  if (assignment.validTo && now > assignment.validTo) {
    return "expired";
  }
  return "active";
}

function mostPermissiveStatus(states) {
  return states.reduce((best, state) => (STATUS_RANK[state] > STATUS_RANK[best] ? state : best), "revoked");
}

/* One find per referenced collection, so N assignments cost three queries. */
async function loadRosterReferenceMaps(assignments) {
  const userIds = new Set();
  const eventIds = new Set();
  for (const assignment of assignments) {
    userIds.add(String(assignment.userId));
    if (assignment.revokedByUserId) userIds.add(String(assignment.revokedByUserId));
    (assignment.eventIds || []).forEach((id) => eventIds.add(String(id)));
  }
  const users = await UserModel.find({ _id: { $in: [...userIds] } })
    .select("fullName emailAddress collegeId")
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const collegeIds = [...new Set(users.map((user) => user.collegeId).filter(Boolean).map(String))];
  const colleges = await CollegeModel.find({ _id: { $in: collegeIds } }).select("commonName").lean();
  const collegeNameById = new Map(colleges.map((college) => [String(college._id), college.commonName]));
  const events = await EventModel.find({ _id: { $in: [...eventIds] } }).select("eventName").lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));
  return { usersById, collegeNameById, eventNameById };
}

function serializeAssignment(assignment, maps) {
  const eventIds = assignment.eventIds || [];
  const revoker = assignment.revokedByUserId
    ? maps.usersById.get(String(assignment.revokedByUserId))
    : null;
  return {
    assignmentId: String(assignment._id),
    role: assignment.role,
    isFestWide: eventIds.length === 0,
    events: eventIds.map((id) => ({
      eventId: String(id),
      eventName: maps.eventNameById.get(String(id)) || null,
    })),
    validFrom: toIso(assignment.validFrom),
    validTo: toIso(assignment.validTo),
    status: assignment.status,
    revokedAt: toIso(assignment.revokedAt),
    revokedByUserId: assignment.revokedByUserId ? String(assignment.revokedByUserId) : null,
    revokedByName: revoker ? revoker.fullName : null,
    revocationReason: assignment.revocationReason || null,
  };
}

/* Person-centric grouping: one entry per user, with all their assignments and a derived currentStatus. */
function buildStaffRoster(assignments, maps, now) {
  const byUser = new Map();
  for (const assignment of assignments) {
    const key = String(assignment.userId);
    byUser.set(key, [...(byUser.get(key) || []), assignment]);
  }
  const people = [...byUser.entries()].map(([userId, userAssignments]) => {
    const user = maps.usersById.get(userId);
    const collegeId = user && user.collegeId ? String(user.collegeId) : null;
    return {
      userId,
      fullName: user ? user.fullName : null,
      emailAddress: user ? user.emailAddress : null,
      collegeName: collegeId ? maps.collegeNameById.get(collegeId) || null : null,
      currentStatus: mostPermissiveStatus(userAssignments.map((assignment) => assignmentState(assignment, now))),
      assignments: [...userAssignments]
        .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
        .map((assignment) => serializeAssignment(assignment, maps)),
    };
  });
  return people.sort((first, second) => String(first.fullName || "").localeCompare(String(second.fullName || "")));
}

module.exports = { assignmentState, mostPermissiveStatus, loadRosterReferenceMaps, buildStaffRoster };
