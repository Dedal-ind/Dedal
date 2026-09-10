const mongoose = require("mongoose");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { CHECKPOINT_TYPES } = require("../constants/scan-constants");

const staffAssignmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /*
     * Exactly one of these is the scope of the role. A college administrator is
     * scoped to a college and exists before any fest does; coordinators and
     * volunteers are scoped to a fest. Enforced in the validator below.
     */
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: "College", default: null },
    festId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /*
     * The events this person works, inside the fest named above. An empty array
     * means the whole fest. One row per (userId, festId, role) — the compound
     * unique index below — so a second event for the same person widens this
     * array rather than inserting another row.
     */
    eventIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
      default: [],
    },

    /*
     * There is deliberately NO offerIds here. Offer scoping on an ASSIGNMENT was
     * tried and reverted: the client's rule is that only volunteers need scan
     * access at offer counters, and a volunteer is already scoped by the
     * volunteer SHIFT they are put on (checkpoint-scoped, see
     * resolveVolunteerCheckpointAuthorization). Coordinators are event-scoped
     * only. Do not re-add it — helpers/migrate-remove-assignment-offer-ids.js
     * exists to clean up rows that briefly carried it.
     */

    /*
     * The window in which the assignment grants anything, derived from the
     * events' own schedule rather than typed in. Null on an assignment that
     * names no event: there is nothing to derive it from.
     */
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },

    /*
     * Volunteer checkpoint-type scoping. An empty array is unrestricted (any type —
     * backward compatible with rows created before this field). A non-empty array
     * limits the volunteer to those checkpoint types. Meaningful only for
     * volunteers; coordinators and administrators are unrestricted regardless.
     */
    allowedCheckpointTypes: {
      type: [{ type: String, enum: Object.values(CHECKPOINT_TYPES) }],
      default: [],
    },

    /*
     * Optional override — a coordinator/volunteer may prefer to use a
     * role-specific phone (e.g. a fest hotline) instead of their personal
     * phoneNumber. If null, the participant surface falls back to
     * user.phoneNumber. Never expose both: reads resolve a single contactPhone
     * (assignmentContactPhone || user.phoneNumber) so the select:false personal
     * number is not leaked alongside.
     */
    assignmentContactPhone: { type: String, trim: true, default: null },

    role: { type: String, required: true, enum: Object.values(STAFF_ROLES) },
    status: {
      type: String,
      required: true,
      enum: Object.values(STAFF_ASSIGNMENT_STATUSES),
      default: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    },

    assignedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    revokedAt: { type: Date, default: null },
    revokedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revocationReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);
// ACCOUNTABILITY INVARIANT: a staff assignment is the paper trail for "who ran this
// event, on this day" — needed months later for a dispute. A row is NEVER deleted,
// only revoked or naturally expired; these hooks block deletion at the data layer.
function blockStaffAssignmentDeletion() {
  /*
   * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
   *
   * The ONE bypass: the environment-gated dev/staging fest purge passes
   * { allowTestPurge: true } so a test fest can be cleared without hand-editing
   * Mongo. Nothing in the production code path sets it, the endpoint that does is
   * refused outside development/staging/test, and removing this block restores the
   * invariant absolutely. It is opt-in per query rather than a global escape hatch
   * precisely so it cannot be reached by accident.
   */
  if (typeof this?.getOptions === "function" && this.getOptions()?.allowTestPurge === true) {
    return;
  }
  throw new Error("Staff assignments are permanent history and cannot be deleted; revoke instead.");
}
const DELETE_QUERY_OPS = ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove"];
staffAssignmentSchema.pre(DELETE_QUERY_OPS, { query: true }, blockStaffAssignmentDeletion);
staffAssignmentSchema.pre("deleteOne", { document: true, query: false }, blockStaffAssignmentDeletion);

/*
 * invalidate() rather than next(error): it attaches the complaint to the field
 * that is actually wrong, so Mongoose reports a ValidationError with a populated
 * `errors` map instead of an opaque Error. Callers can read errors.festId.
 */
staffAssignmentSchema.pre("validate", function validateAssignmentScope(next) {
  // The platform owner is scoped to neither a college nor a fest — it is over
  // everything, so both must be absent.
  if (this.role === STAFF_ROLES.PLATFORM_ADMIN) {
    if (this.collegeId) {
      this.invalidate("collegeId", "A platformAdmin assignment must not carry collegeId.");
    }
    if (this.festId) {
      this.invalidate("festId", "A platformAdmin assignment must not carry festId.");
    }
    return next();
  }

  if (this.role === STAFF_ROLES.ADMINISTRATOR) {
    if (!this.collegeId) {
      this.invalidate("collegeId", "An administrator assignment requires collegeId.");
    }
    if (this.festId) {
      this.invalidate("festId", "An administrator assignment must not carry festId.");
    }
    return next();
  }

  // Coordinator and volunteer are fest-scoped. collegeId may be null or set.
  if (!this.festId) {
    this.invalidate("festId", `A ${this.role} assignment requires festId.`);
  }
  return next();
});

/*
 * Mongo compares null to null as equal inside a unique index, so a plain
 * compound unique index over these four keys already blocks a duplicate
 * administrator grant (userId, null festId, collegeId, role).
 *
 * The partial filter narrows uniqueness to active rows. Without it, revoking an
 * assignment and later re-granting it would collide with the revoked document
 * that still sits in the collection.
 */
staffAssignmentSchema.index(
  { userId: 1, festId: 1, collegeId: 1, role: 1 },
  {
    name: "index_staffAssignments_userId_festId_collegeId_role",
    unique: true,
    partialFilterExpression: { status: STAFF_ASSIGNMENT_STATUSES.ACTIVE },
  }
);

staffAssignmentSchema.index(
  { userId: 1, status: 1 },
  { name: "index_staffAssignments_userId_status" }
);

staffAssignmentSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const StaffAssignmentModel = mongoose.model(
  "StaffAssignment",
  staffAssignmentSchema,
  "staffAssignments"
);

module.exports = { StaffAssignmentModel };
