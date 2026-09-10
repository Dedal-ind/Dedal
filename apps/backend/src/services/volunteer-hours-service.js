const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ScanModel } = require("../models/scan-model");
const { UserModel } = require("../models/user-model");
const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { SHIFT_STATUSES } = require("../constants/shift-constants");

/*
 * Proof of service. A volunteer who stood at a gate for three days needs to be
 * able to tell their college how long — and the system already knows, because
 * every shift carries startsAt and endsAt.
 *
 * HOURS ARE COMPUTED, NEVER ENTERED. There is no field anywhere for a volunteer
 * (or a coordinator) to type a number into: the figure is derived from shift
 * rows on every read. A self-reported hours field would be the first thing
 * anyone inflated, and the whole value of this report is that a college can
 * trust it.
 *
 * THE CLOCK IS CLAMPED. A shift's contribution is
 *     min(endsAt, now) - startsAt
 * so a shift currently in progress counts only the part already worked, and a
 * shift that has not started counts nothing. Without the clamp, a volunteer
 * rostered for a 12-hour shift could open this an hour in and be told they had
 * worked 12 hours — a number their college would then be handed.
 */

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/* One decimal. "7.5 hours" is what goes in a letter; 7.483333 is not. */
function toRoundedHours(milliseconds) {
  return Math.round((milliseconds / MILLISECONDS_PER_HOUR) * 10) / 10;
}

function computeShiftWorkedMilliseconds(shift, now) {
  const startMs = new Date(shift.startsAt).getTime();
  const endMs = new Date(shift.endsAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= now.getTime()) {
    return 0; // not started yet, or an unusable window
  }
  const workedUntilMs = Math.min(endMs, now.getTime());
  return Math.max(0, workedUntilMs - startMs);
}

/*
 * Every scan this volunteer personally recorded inside the shift's window at
 * that shift's checkpoint. Attributed by scannedByUserId, so two volunteers
 * sharing a gate each get credit for their own work rather than for the
 * checkpoint's total.
 */
async function countScansForShifts(userId, shifts) {
  if (shifts.length === 0) {
    return new Map();
  }
  const scans = await ScanModel.find({
    scannedByUserId: userId,
    checkpointId: { $in: shifts.map((shift) => shift.checkpointId) },
  })
    .select("checkpointId scannedAt")
    .lean();

  const scanCountByShiftId = new Map();
  for (const shift of shifts) {
    const startMs = new Date(shift.startsAt).getTime();
    const endMs = new Date(shift.endsAt).getTime();
    const count = scans.filter(
      (scan) =>
        String(scan.checkpointId) === String(shift.checkpointId) &&
        new Date(scan.scannedAt).getTime() >= startMs &&
        new Date(scan.scannedAt).getTime() <= endMs
    ).length;
    scanCountByShiftId.set(String(shift._id), count);
  }
  return scanCountByShiftId;
}

/*
 * The volunteer's own service record. Volunteer-only: a coordinator asking for
 * this is asking the wrong surface, and answering with an empty shell would
 * look like "you worked zero hours" rather than "this is not your screen".
 */
async function getVolunteerHoursSummary(userId, now = new Date()) {
  const volunteerAssignments = await StaffAssignmentModel.find({
    userId,
    role: STAFF_ROLES.VOLUNTEER,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("festId")
    .lean();
  if (volunteerAssignments.length === 0) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "Only volunteers have a service record."
    );
  }

  /*
   * CANCELLED shifts are excluded: a shift that was called off was not worked,
   * whatever its window said. Every other status counts, because a shift whose
   * window has passed is service rendered regardless of what the row is called.
   */
  const shifts = await VolunteerShiftModel.find({
    userId,
    status: { $ne: SHIFT_STATUSES.CANCELLED },
    startsAt: { $lte: now },
  })
    .populate("checkpointId", "checkpointName eventId")
    .populate("festId", "festName")
    .sort({ startsAt: 1 })
    .lean();

  const scanCountByShiftId = await countScansForShifts(userId, shifts);

  // Event names in one query rather than one per shift.
  const eventIds = [
    ...new Set(
      shifts
        .map((shift) => shift.checkpointId?.eventId)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const events = await EventModel.find({ _id: { $in: eventIds } }).select("eventName").lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));

  let totalWorkedMilliseconds = 0;
  const shiftRows = shifts.map((shift) => {
    const workedMilliseconds = computeShiftWorkedMilliseconds(shift, now);
    totalWorkedMilliseconds += workedMilliseconds;
    return {
      checkpointName: shift.checkpointId?.checkpointName ?? "",
      // A fest-wide checkpoint (a main gate) belongs to no event.
      eventName: shift.checkpointId?.eventId
        ? eventNameById.get(String(shift.checkpointId.eventId)) ?? ""
        : null,
      festName: shift.festId?.festName ?? "",
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      durationHours: toRoundedHours(workedMilliseconds),
      scanCount: scanCountByShiftId.get(String(shift._id)) ?? 0,
    };
  });

  const volunteer = await UserModel.findById(userId)
    .select("fullName emailAddress collegeId")
    .populate("collegeId", "commonName collegeName")
    .lean();

  /*
   * Summed from the raw milliseconds, NOT from the rounded per-shift figures:
   * three shifts of 2.45h each would otherwise print as 2.5+2.5+2.5=7.5 against
   * a stated total of 7.4, and a report that does not add up is a report a
   * college will not accept.
   */
  return {
    totalHoursWorked: toRoundedHours(totalWorkedMilliseconds),
    shiftCount: shiftRows.length,
    shifts: shiftRows,
    // The fests they served, deduped — a volunteer may work more than one.
    festName: [...new Set(shiftRows.map((row) => row.festName).filter(Boolean))].join(", "),
    volunteerFullName: volunteer?.fullName ?? "",
    volunteerEmailAddress: volunteer?.emailAddress ?? "",
    collegeName: volunteer?.collegeId?.commonName ?? volunteer?.collegeId?.collegeName ?? "",
    generatedAt: now,
  };
}

/*
 * Total worked hours for many volunteers at once, for the admin staff list and
 * the staff CSV. One aggregation over the whole fest rather than a query per
 * assignee — a fest with eighty volunteers would otherwise be eighty round
 * trips to render one column.
 */
async function getWorkedHoursByUserId(festId, now = new Date()) {
  const shifts = await VolunteerShiftModel.find({
    festId,
    status: { $ne: SHIFT_STATUSES.CANCELLED },
    startsAt: { $lte: now },
  })
    .select("userId startsAt endsAt")
    .lean();

  const millisecondsByUserId = new Map();
  for (const shift of shifts) {
    const key = String(shift.userId);
    millisecondsByUserId.set(
      key,
      (millisecondsByUserId.get(key) ?? 0) + computeShiftWorkedMilliseconds(shift, now)
    );
  }
  return new Map(
    [...millisecondsByUserId.entries()].map(([key, milliseconds]) => [
      key,
      toRoundedHours(milliseconds),
    ])
  );
}

module.exports = {
  getVolunteerHoursSummary,
  getWorkedHoursByUserId,
  computeShiftWorkedMilliseconds,
  toRoundedHours,
};
