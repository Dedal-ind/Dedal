const { PassModel } = require("../models/pass-model");
const { UserModel } = require("../models/user-model");
const { ScanModel } = require("../models/scan-model");
const { SCAN_RESULTS } = require("../constants/scan-constants");

const RECENT_SCAN_LIMIT = 10;

const ACTIVE_WITHIN_MINUTES = 5;
const IDLE_WITHIN_MINUTES = 15;

/*
 * Derived from the enum rather than listed here, so a rejection code added to
 * scan-constants later is counted without this file being touched. manualOverride
 * is deliberately neither accepted nor rejected: it is its own outcome, and
 * folding it into "rejected" by subtracting from the total would misreport it.
 */
const REJECTED_SCAN_RESULTS = Object.values(SCAN_RESULTS).filter((result) =>
  result.startsWith("rejected")
);

const COUNT_ACCUMULATORS = {
  accepted: { $sum: { $cond: [{ $eq: ["$result", SCAN_RESULTS.ACCEPTED] }, 1, 0] } },
  rejected: { $sum: { $cond: [{ $in: ["$result", REJECTED_SCAN_RESULTS] }, 1, 0] } },
  total: { $sum: 1 },
};

const EMPTY_TALLY = { accepted: 0, rejected: 0, total: 0 };

/*
 * Fest-wide traffic per checkpoint, counted from the fest's own start rather than
 * a rolling 24h window: the contract calls this "the fest window so far", and a
 * fixed lower bound keeps the number stable across refreshes instead of drifting
 * as the window slides. index_scans_checkpointId_scannedAt serves the match.
 */
async function summariseCheckpointScans(checkpointIds, windowStart) {
  const rows = await ScanModel.aggregate([
    { $match: { checkpointId: { $in: checkpointIds }, scannedAt: { $gte: windowStart } } },
    { $group: { _id: "$checkpointId", ...COUNT_ACCUMULATORS } },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      { acceptedCount: row.accepted, rejectedCount: row.rejected, totalCount: row.total },
    ])
  );
}

function resolveActivityStatus(minutesSinceLastScan) {
  if (minutesSinceLastScan === null) {
    return "no-scans-yet";
  }
  if (minutesSinceLastScan < ACTIVE_WITHIN_MINUTES) {
    return "active";
  }
  if (minutesSinceLastScan <= IDLE_WITHIN_MINUTES) {
    return "idle";
  }
  return "stale";
}

/*
 * Every on-shift volunteer's tally in one aggregation. Each shift contributes its
 * own $or clause because the lower bound is that shift's start, not a time shared
 * across volunteers — a tally scoped to the fest would credit a volunteer for
 * scans from a shift they already finished.
 */
async function summariseVolunteerScans(shifts) {
  if (shifts.length === 0) {
    return () => ({ scanCounts: { ...EMPTY_TALLY }, lastScanAt: null, minutesSinceLastScan: null, activityStatus: "no-scans-yet" });
  }

  const rows = await ScanModel.aggregate([
    {
      $match: {
        $or: shifts.map((shift) => ({
          scannedByUserId: shift.userId,
          checkpointId: shift.checkpointId,
          scannedAt: { $gte: shift.startsAt },
        })),
      },
    },
    {
      $group: {
        _id: { userId: "$scannedByUserId", checkpointId: "$checkpointId" },
        ...COUNT_ACCUMULATORS,
        lastScanAt: { $max: "$scannedAt" },
      },
    },
  ]);

  const byShift = new Map(
    rows.map((row) => [`${row._id.userId}:${row._id.checkpointId}`, row])
  );

  return (shift, generatedAt) => {
    const row = byShift.get(`${shift.userId}:${shift.checkpointId}`);
    if (!row) {
      return { scanCounts: { ...EMPTY_TALLY }, lastScanAt: null, minutesSinceLastScan: null, activityStatus: "no-scans-yet" };
    }

    const minutesSinceLastScan = Math.floor(
      (generatedAt.getTime() - row.lastScanAt.getTime()) / 60000
    );
    return {
      scanCounts: { accepted: row.accepted, rejected: row.rejected, total: row.total },
      lastScanAt: row.lastScanAt.toISOString(),
      minutesSinceLastScan,
      activityStatus: resolveActivityStatus(minutesSinceLastScan),
    };
  };
}

/*
 * A scan names a pass, not a participant, and the pass may be null on a
 * rejectedPassNotFound row — so the participant fields resolve through the pass
 * when there is one and stay null when there is not, rather than dropping the row.
 */
async function buildRecentScans(checkpointIds, checkpointNames) {
  const scans = await ScanModel.find({ checkpointId: { $in: checkpointIds } })
    .sort({ scannedAt: -1 })
    .limit(RECENT_SCAN_LIMIT)
    .lean();

  const passIds = scans.map((scan) => scan.passId).filter(Boolean);
  const passes = await PassModel.find({ _id: { $in: passIds } })
    .select("userId")
    .lean();
  const passOwners = new Map(passes.map((pass) => [String(pass._id), String(pass.userId)]));

  const users = await UserModel.find({
    _id: { $in: [...scans.map((scan) => scan.scannedByUserId), ...passes.map((pass) => pass.userId)] },
  })
    .select("fullName")
    .lean();
  const namesByUserId = new Map(users.map((user) => [String(user._id), user.fullName]));

  return scans.map((scan) => {
    const participantUserId = scan.passId ? passOwners.get(String(scan.passId)) || null : null;
    return {
      scanId: String(scan._id),
      scannedAt: scan.scannedAt.toISOString(),
      scannedByUserId: String(scan.scannedByUserId),
      scannedByFullName: namesByUserId.get(String(scan.scannedByUserId)) || null,
      checkpointId: String(scan.checkpointId),
      checkpointName: checkpointNames.get(String(scan.checkpointId)) || null,
      participantUserId,
      participantFullName: participantUserId ? namesByUserId.get(participantUserId) || null : null,
      result: scan.result,
      scanMethod: scan.scanMethod,
      direction: scan.direction,
    };
  });
}

module.exports = { summariseCheckpointScans, summariseVolunteerScans, buildRecentScans };
