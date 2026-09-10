const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { ScanModel } = require("../models/scan-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { SHIFT_STATUSES } = require("../constants/shift-constants");
const {
  CHECKPOINT_TYPES,
  CHECKPOINT_DIRECTION_MODES,
  SCAN_DIRECTIONS,
  SCAN_RESULTS,
} = require("../constants/scan-constants");
const { ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
const {
  resolveVolunteerCheckpointAuthorization,
  VOLUNTEER_AUTHORIZATION,
} = require("../helpers/scan-decision-helpers");

/*
 * The volunteer's own view of their responsibilities: which checkpoints they
 * stand at, how many people are expected there, how many are through, and their
 * own contribution. Volunteer-only — coordinators and admins have their own
 * surfaces and are refused here rather than shown an empty shell.
 */

async function loadActiveVolunteerAssignments(userId) {
  return StaffAssignmentModel.find({
    userId,
    role: STAFF_ROLES.VOLUNTEER,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
}

/*
 * The volunteer's checkpoints are the ones their SCHEDULED shifts name — the
 * same source of truth the scanner authorization uses, so the dashboard can
 * never show a checkpoint the scanner would refuse. Auto-shifts (Section B)
 * guarantee a freshly assigned volunteer has shifts to see here.
 */
async function loadVolunteerCheckpoints(userId, festIds) {
  const shifts = await VolunteerShiftModel.find({
    userId,
    festId: { $in: festIds },
    status: SHIFT_STATUSES.SCHEDULED,
  })
    .select("checkpointId festId")
    .lean();
  const checkpointIds = [...new Set(shifts.map((shift) => String(shift.checkpointId)))];
  return CheckpointModel.find({ _id: { $in: checkpointIds }, isActive: true }).lean();
}

/*
 * Which entitlement admits someone at this checkpoint — the same mapping the
 * scan decision uses: offerClaim for an offer counter (matched on the offerId
 * the checkpoint points at), eventEntry for an event door (matched on the
 * eventId), gateAccess for the main gate (no reference).
 */
function entitlementMatchForCheckpoint(checkpoint) {
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.OFFER) {
    return { entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM, referenceId: checkpoint.offerId };
  }
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.EVENT_ENTRY) {
    return { entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY, referenceId: checkpoint.eventId };
  }
  return { entitlementType: ENTITLEMENT_TYPES.GATE_ACCESS };
}

/*
 * toCheckInCount: distinct participants holding an ACTIVE entitlement valid at
 * this checkpoint. One pipeline: match the entitlement shape → join the pass
 * (scoping to the checkpoint's fest AND yielding the person) → count distinct
 * pass holders (a pass is unique per user+fest, so distinct passes = people).
 */
async function countExpectedParticipants(checkpoint) {
  const [row] = await EntitlementModel.aggregate([
    // fields: entitlementType, referenceId, status
    { $match: { ...entitlementMatchForCheckpoint(checkpoint), status: ENTITLEMENT_STATUSES.ACTIVE } },
    // fields: passId → passes._id (festId scopes to this fest; userId is the person)
    { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $match: { "pass.festId": checkpoint.festId } },
    { $group: { _id: "$pass.userId" } },
    { $count: "distinctParticipants" },
  ]);
  return row ? row.distinctParticipants : 0;
}

/*
 * checkedInCount / checkedOutCount: distinct participants with at least one
 * ACCEPTED scan at this checkpoint in each direction, by ANY scanner. One
 * pipeline: match accepted scans here → distinct (direction, passId) → count
 * per direction (distinct passes = distinct people, same uniqueness as above).
 */
async function countScannedParticipantsByDirection(checkpoint) {
  const rows = await ScanModel.aggregate([
    // fields: checkpointId, result, direction, passId
    { $match: { checkpointId: checkpoint._id, result: SCAN_RESULTS.ACCEPTED } },
    { $group: { _id: { direction: "$direction", passId: "$passId" } } },
    { $group: { _id: "$_id.direction", distinctParticipants: { $sum: 1 } } },
  ]);
  const byDirection = new Map(rows.map((row) => [row._id, row.distinctParticipants]));
  return {
    checkedInCount: byDirection.get(SCAN_DIRECTIONS.IN) ?? 0,
    checkedOutCount: byDirection.get(SCAN_DIRECTIONS.OUT) ?? 0,
  };
}

/* myScansToday: the calling volunteer's OWN scans here since UTC midnight. */
async function countMyScansToday(checkpoint, userId) {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  return ScanModel.countDocuments({
    checkpointId: checkpoint._id,
    scannedByUserId: userId,
    scannedAt: { $gte: startOfToday },
  });
}


/*
 * The "Recent Check-ins" list on the volunteer hub. The screen has rendered
 * data.recentScans since it was designed, but the summary never supplied the
 * field — the tab was permanently "No check-ins yet" no matter how many people
 * had scanned. Latest first, capped small: this is a glanceable feed, not a
 * report (the CSVs are the report).
 */
const RECENT_SCANS_LIMIT = 15;

async function loadRecentCheckIns(checkpoint) {
  const rows = await ScanModel.aggregate([
    {
      $match: {
        checkpointId: checkpoint._id,
        result: SCAN_RESULTS.ACCEPTED,
        direction: SCAN_DIRECTIONS.IN,
      },
    },
    { $sort: { scannedAt: -1 } },
    { $limit: RECENT_SCANS_LIMIT },
    { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
    { $unwind: { path: "$pass", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "users", localField: "pass.userId", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  ]);
  return rows.map((row) => ({
    scanId: String(row._id),
    participantName: row.user?.fullName ?? null,
    scannedAt: row.scannedAt ?? null,
  }));
}

async function getVolunteerSummary(userId) {
  const assignments = await loadActiveVolunteerAssignments(userId);
  if (assignments.length === 0) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "This dashboard is for active volunteers."
    );
  }

  const festIds = assignments.map((assignment) => assignment.festId);
  const checkpoints = await loadVolunteerCheckpoints(userId, festIds);

  const fests = await FestModel.find({ _id: { $in: festIds } }).select("festName").lean();
  const festNameById = new Map(fests.map((fest) => [String(fest._id), fest.festName]));
  const eventIds = checkpoints.map((checkpoint) => checkpoint.eventId).filter(Boolean);
  const events = await EventModel.find({ _id: { $in: eventIds } })
    /* eventType + poster feed the hub's poster card — a volunteer should see
     * at a glance whether the gate they run belongs to a solo or team event. */
    .select("eventName eventType posterImageUrl bannerImageUrl startsAt endsAt")
    .lean();
  const eventsById = new Map(events.map((event) => [String(event._id), event]));

  const scope = [];
  for (const checkpoint of checkpoints) {
    const event = checkpoint.eventId ? eventsById.get(String(checkpoint.eventId)) : null;
    const toCheckInCount = await countExpectedParticipants(checkpoint);
    const { checkedInCount, checkedOutCount } = await countScannedParticipantsByDirection(checkpoint);
    scope.push({
      checkpointId: String(checkpoint._id),
      checkpointName: checkpoint.checkpointName,
      checkpointType: checkpoint.checkpointType,
      directionMode: checkpoint.directionMode,
      /*
       * The fest id, additively. A GATE block on the volunteer's dashboard
       * shows the day's campus-entry tally, which is a FEST-level figure
       * (/fests/:festId/gate-activity) — the checkpoint id alone cannot address
       * it, and the name is not an identifier.
       */
      festId: String(checkpoint.festId),
      festName: festNameById.get(String(checkpoint.festId)) ?? null,
      eventName: event?.eventName ?? null, // null for a fest-wide gate
      eventType: event?.eventType ?? null,
      posterImageUrl: event?.posterImageUrl ?? event?.bannerImageUrl ?? null,
      eventStartsAt: event?.startsAt ?? null,
      eventEndsAt: event?.endsAt ?? null,
      toCheckInCount,
      checkedInCount,
      // A checked-out count only means something where exits are recorded.
      checkedOutCount:
        checkpoint.directionMode === CHECKPOINT_DIRECTION_MODES.IN_AND_OUT ? checkedOutCount : null,
      pendingCount: Math.max(0, toCheckInCount - checkedInCount),
      myScansToday: await countMyScansToday(checkpoint, userId),
      recentScans: await loadRecentCheckIns(checkpoint),
    });
  }
  return { scope };
}

/*
 * The download gate, same shape as scan authorization: a volunteer may export a
 * checkpoint they could scan at — an active shift there now, or the pre-shift
 * fallback while they have no shifts at all. DENIED (they have shifts, none of
 * which put them here) is a 403, exactly like someone else's checkpoint.
 */
async function assertVolunteerMayExportCheckpoint(userId, checkpointId) {
  const checkpoint = await CheckpointModel.findById(checkpointId).lean();
  if (!checkpoint) {
    throw new ApplicationError(404, ERROR_CODES.CHECKPOINT_NOT_FOUND, "Checkpoint not found.");
  }
  const assignment = await StaffAssignmentModel.findOne({
    userId,
    festId: checkpoint.festId,
    role: STAFF_ROLES.VOLUNTEER,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
  if (!assignment) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "You are not a volunteer of this fest."
    );
  }
  const decision = await resolveVolunteerCheckpointAuthorization({
    userId,
    festId: checkpoint.festId,
    checkpointId: checkpoint._id,
    now: new Date(),
  });
  if (decision === VOLUNTEER_AUTHORIZATION.DENIED) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "This checkpoint is not covered by your shifts."
    );
  }
  return checkpoint;
}

module.exports = {
  getVolunteerSummary,
  assertVolunteerMayExportCheckpoint,
  entitlementMatchForCheckpoint,
};
