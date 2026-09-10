const STAFF_ROLES = {
  // The product owner: a platform-scoped superadmin (collegeId + festId both null).
  // Onboards colleges, and — god mode — passes every college/fest admin check.
  PLATFORM_ADMIN: "platformAdmin",
  // A college administrator: scoped to one college, manages that college's fests.
  ADMINISTRATOR: "administrator",
  COORDINATOR: "coordinator",
  VOLUNTEER: "volunteer",
};

const STAFF_ASSIGNMENT_STATUSES = {
  ACTIVE: "active",
  REVOKED: "revoked",
};

module.exports = { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES };
