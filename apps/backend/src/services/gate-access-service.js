const mongoose = require("mongoose");

const { DailyGateCheckInModel } = require("../models/daily-gate-checkin-model");
const { PassModel } = require("../models/pass-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { UserModel } = require("../models/user-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  CHECKPOINT_TYPES,
  SCAN_DIRECTIONS,
  SCAN_RESULTS,
} = require("../constants/scan-constants");
const {
  resolveTodayFestDayKey,
  resolveFestDayKey,
  isValidFestDayKey,
} = require("../helpers/fest-day-helpers");

const DUPLICATE_KEY_ERROR_CODE = 11000;

/*
 * CAMPUS ACCESS: the layer that answers "is this person on campus today".
 *
 * The entitlement system answers "may this person pass this checkpoint" and is
 * unchanged. This service answers a different question that the entitlement
 * system structurally cannot: gate access is unlimited by design (a participant
 * walks in and out all day), so its usedCount counts crossings, not days, and
 * nothing in it distinguishes "arrived this morning" from "arrived on Tuesday".
 *
 * Everything inside the campus — event doors, food, accommodation — reads
 * hasCheckedInToday before it opens. Travel is the exception and is exempted at
 * the checkpoint (see checkpoint-model.isExemptFromGateCheck).
 */

/*
 * Records the FIRST crossing of the day, and reports whether it was the first.
 *
 * The insert is the test. Reading "is there a row?" and then writing one leaves a
 * window in which two gate lanes scanning the same person at once both see no row
 * and both insert — and the day's entry count drifts up every time an entrance
 * queue splits, which is exactly when it matters. So the unique index decides:
 * whoever inserts is the first entry, a duplicate-key error means someone already
 * was, and there is no window between the two because there is only one statement.
 *
 * Never throws for a scan-path caller. A failure to RECORD attendance must not
 * turn an otherwise-valid gate scan into a refusal at a physical entrance with a
 * queue behind it — the entitlement already said yes, and the worst case of a
 * swallowed failure is an under-counted dashboard.
 */
async function recordGateEntry({ pass, checkpoint, scannedByUserId, at = new Date() }) {
  const checkInDate = resolveFestDayKey(at);
  try {
    await DailyGateCheckInModel.create({
      passId: pass._id,
      festId: pass.festId,
      checkInDate,
      checkedInAt: at,
      checkedInByUserId: scannedByUserId ?? null,
      checkpointId: checkpoint?._id ?? null,
    });
    return { isReEntry: false, checkInDate, firstCheckedInAt: at };
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
      // Attendance is a reporting concern; the door is not held shut for it.
      console.error(`Daily gate check-in could not be recorded: ${error.message}`);
      return { isReEntry: false, checkInDate, firstCheckedInAt: null, recordFailed: true };
    }
    /*
     * Already in today. The ORIGINAL arrival time is what the volunteer needs to
     * see ("re-entry — first in at 09:41"), not this scan's timestamp, so the
     * existing row is read back rather than reporting `at`.
     */
    const existing = await DailyGateCheckInModel.findOne({
      passId: pass._id,
      festId: pass.festId,
      checkInDate,
    })
      .select("checkedInAt")
      .lean();
    return {
      isReEntry: true,
      checkInDate,
      firstCheckedInAt: existing?.checkedInAt ?? null,
    };
  }
}

/* Whether this pass has crossed the gate today. The precondition every inside-the-
 * campus checkpoint checks; a lean existence read, not a document load. */
async function hasCheckedInToday(passId, festId, at = new Date()) {
  const found = await DailyGateCheckInModel.findOne({
    passId,
    festId,
    checkInDate: resolveFestDayKey(at),
  })
    .select("_id")
    .lean();
  return Boolean(found);
}

/*
 * The participant's own campus-access history for one pass. Owner-only: the
 * caller's userId must own the pass, or this is a way to learn when any given
 * stranger was on campus.
 */
async function getPassGateStatus(userId, passId) {
  const pass = mongoose.Types.ObjectId.isValid(passId)
    ? await PassModel.findById(passId).select("userId festId").lean()
    : null;
  if (!pass) {
    throw new ApplicationError(404, ERROR_CODES.PASS_NOT_FOUND, "Pass not found.");
  }
  if (String(pass.userId) !== String(userId)) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "You can only view your own pass."
    );
  }

  const todayKey = resolveTodayFestDayKey();
  const rows = await DailyGateCheckInModel.find({ passId: pass._id, festId: pass.festId })
    .select("checkInDate checkedInAt")
    .sort({ checkInDate: 1 })
    .lean();

  const todayRow = rows.find((row) => row.checkInDate === todayKey) ?? null;
  return {
    today: {
      date: todayKey,
      checkedIn: Boolean(todayRow),
      checkedInAt: todayRow?.checkedInAt ?? null,
    },
    history: rows.map((row) => ({ date: row.checkInDate, checkedInAt: row.checkedInAt })),
  };
}

/*
 * The admin dashboard's campus-access figures for one fest on one day.
 *
 * "On campus right now" is derived from the GATE's scans, not from the check-in
 * rows: a check-in row says someone arrived today, and says nothing about their
 * having left again. The gate is the one inAndOut checkpoint in the system, so
 * the last accepted scan per pass tells you which side of it they are on. A pass
 * whose most recent gate scan today was IN is inside; one whose most recent was
 * OUT has gone. Counting entries minus exits instead would go wrong the moment
 * anyone left and came back, which at a fest is most people.
 */
async function getFestGateStats(festId, dateKey) {
  const checkInDate = isValidFestDayKey(dateKey) ? dateKey : resolveTodayFestDayKey();

  const gateCheckpoints = await CheckpointModel.find({
    festId,
    checkpointType: CHECKPOINT_TYPES.GATE,
  })
    .select("_id")
    .lean();
  const gateCheckpointIds = gateCheckpoints.map((checkpoint) => checkpoint._id);

  const uniqueEntrantCount = await DailyGateCheckInModel.countDocuments({ festId, checkInDate });

  let currentlyOnCampus = 0;
  let totalGateScans = 0;
  if (gateCheckpointIds.length > 0) {
    /*
     * Bounded to the day being asked about, in the fest's timezone. The day key
     * is the authority everywhere else in this feature, so the window is derived
     * from it by re-keying each scan rather than by a UTC range — a UTC range
     * would slice the day at 05:30 local and put the first hours of a fest day
     * in the wrong bucket.
     */
    const dayScans = await ScanModel.find({
      checkpointId: { $in: gateCheckpointIds },
      result: SCAN_RESULTS.ACCEPTED,
      passId: { $ne: null },
    })
      .select("passId direction scannedAt")
      .sort({ scannedAt: 1 })
      .lean();

    const lastDirectionByPassId = new Map();
    for (const scan of dayScans) {
      if (resolveFestDayKey(new Date(scan.scannedAt)) !== checkInDate) {
        continue;
      }
      totalGateScans += 1;
      // Sorted ascending, so the last write per pass is the most recent scan.
      lastDirectionByPassId.set(String(scan.passId), scan.direction);
    }
    for (const direction of lastDirectionByPassId.values()) {
      if (direction === SCAN_DIRECTIONS.IN) {
        currentlyOnCampus += 1;
      }
    }
  }

  return {
    date: checkInDate,
    uniqueEntrantCount,
    totalGateScans,
    currentlyOnCampus,
  };
}

/*
 * The gate volunteer's own view: today's tally plus the last few faces through
 * the door, so they can see the scanner is actually recording.
 */
async function getGateActivity(festId, { limit = 10 } = {}) {
  const checkInDate = resolveTodayFestDayKey();
  const gateCheckpoints = await CheckpointModel.find({
    festId,
    checkpointType: CHECKPOINT_TYPES.GATE,
  })
    .select("_id")
    .lean();

  const entryCount = await DailyGateCheckInModel.countDocuments({ festId, checkInDate });
  if (gateCheckpoints.length === 0) {
    return { date: checkInDate, entryCount, recentEntries: [] };
  }

  const recent = await DailyGateCheckInModel.find({ festId, checkInDate })
    .select("passId checkedInAt")
    .sort({ checkedInAt: -1 })
    .limit(Math.min(Math.max(1, limit), 50))
    .lean();

  const passes = await PassModel.find({ _id: { $in: recent.map((row) => row.passId) } })
    .select("userId")
    .lean();
  const userIdByPassId = new Map(passes.map((pass) => [String(pass._id), String(pass.userId)]));
  const users = await UserModel.find({ _id: { $in: [...userIdByPassId.values()] } })
    .select("fullName usn")
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  return {
    date: checkInDate,
    entryCount,
    recentEntries: recent.map((row) => {
      const user = userById.get(userIdByPassId.get(String(row.passId)) ?? "");
      return {
        checkedInAt: row.checkedInAt,
        fullName: user?.fullName ?? null,
        usn: user?.usn ?? null,
      };
    }),
  };
}

module.exports = {
  recordGateEntry,
  hasCheckedInToday,
  getPassGateStatus,
  getFestGateStats,
  getGateActivity,
};
