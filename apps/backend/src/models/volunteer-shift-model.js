const mongoose = require("mongoose");
const { SHIFT_STATUSES, SHIFT_STATUS_VALUES } = require("../constants/shift-constants");

/*
 * A volunteer scheduled at one checkpoint for one time window. Unlike the coarse
 * staffAssignment (which grants a whole-fest window), a shift is the precise unit
 * the scanner authorizes against once a volunteer has any shift in the fest.
 *
 * Overlaps are intentionally allowed — handoff coverage needs them — so there is
 * no unique constraint. The frontend warns on overlap (allow-and-warn); the server
 * never rejects one.
 */
const volunteerShiftSchema = new mongoose.Schema(
  {
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    checkpointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Checkpoint",
      required: true,
      index: true,
    },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    status: {
      type: String,
      required: true,
      enum: SHIFT_STATUS_VALUES,
      default: SHIFT_STATUSES.SCHEDULED,
    },

    assignedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /*
     * Reminder idempotency stamps. Two emails per shift — 12 hours out and 1
     * hour out — and the stamp IS the lock: the sweep claims a shift with a
     * findOneAndUpdate filtered on the field still being null, so two overlapping
     * sweeps (or two server processes) cannot both send. Never a boolean: the
     * timestamp also answers "when did we tell them", which support asks.
     */
    reminderSentAt12h: { type: Date, default: null },
    reminderSentAt1h: { type: Date, default: null },

    cancellationReason: { type: String, trim: true, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/*
 * The window invariant. invalidate() attaches the complaint to endsAt so the
 * ValidationError carries a populated errors map (errors.endsAt) with a stable
 * SHIFT_INVALID_WINDOW code the service can surface.
 */
volunteerShiftSchema.pre("validate", function validateShiftWindow(next) {
  if (this.startsAt && this.endsAt && this.startsAt.getTime() >= this.endsAt.getTime()) {
    this.invalidate("endsAt", "A shift must end after it starts.", this.endsAt, "SHIFT_INVALID_WINDOW");
  }
  return next();
});

// Scanner authorization: equality on user + checkpoint, range on time.
volunteerShiftSchema.index(
  { userId: 1, checkpointId: 1, startsAt: 1 },
  { name: "index_volunteerShifts_userId_checkpointId_startsAt" }
);
// /shifts/mine: equality on user + status, sort/range on startsAt.
volunteerShiftSchema.index(
  { userId: 1, status: 1, startsAt: 1 },
  { name: "index_volunteerShifts_userId_status_startsAt" }
);
// Fest-scoped listing.
volunteerShiftSchema.index(
  { festId: 1, startsAt: 1 },
  { name: "index_volunteerShifts_festId_startsAt" }
);
/*
 * The reminder sweep runs every few minutes forever, so its query must not be a
 * collection scan that grows with shift history. Status first (equality) then
 * startsAt (range) — the sweep's two variants differ only in which stamp they
 * additionally test for null, which is cheap once this index has narrowed the
 * candidates to upcoming scheduled shifts.
 */
volunteerShiftSchema.index(
  { status: 1, startsAt: 1 },
  { name: "index_volunteerShifts_status_startsAt" }
);

volunteerShiftSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const VolunteerShiftModel = mongoose.model("VolunteerShift", volunteerShiftSchema, "volunteerShifts");

module.exports = { VolunteerShiftModel };
