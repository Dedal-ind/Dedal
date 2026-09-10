const { UserModel } = require("../models/user-model");
const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { SHIFT_STATUSES } = require("../constants/shift-constants");

const UPCOMING_WINDOW_MINUTES = 60;

/*
 * The two shift sets the snapshot needs, read together: whoever is on the door
 * right now, and whoever is due within the hour. A cancelled shift is neither —
 * only a scheduled one puts someone on a checkpoint.
 */
async function loadShiftRows(checkpointIds, generatedAt) {
  const upcomingCutoff = new Date(generatedAt.getTime() + UPCOMING_WINDOW_MINUTES * 60 * 1000);

  const [onShiftRows, upcomingRows] = await Promise.all([
    VolunteerShiftModel.find({
      checkpointId: { $in: checkpointIds },
      status: SHIFT_STATUSES.SCHEDULED,
      startsAt: { $lte: generatedAt },
      endsAt: { $gte: generatedAt },
    })
      .sort({ startsAt: 1 })
      .lean(),
    VolunteerShiftModel.find({
      checkpointId: { $in: checkpointIds },
      status: SHIFT_STATUSES.SCHEDULED,
      startsAt: { $gt: generatedAt, $lte: upcomingCutoff },
    })
      .sort({ startsAt: 1 })
      .lean(),
  ]);

  return { onShiftRows, upcomingRows };
}

/* Batch-loaded once and shared by both shift lists, so no row resolves its own name. */
async function loadUserDirectory(userIds) {
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("fullName emailAddress")
    .lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

function toShiftIdentity(shift, users, checkpointNames) {
  const user = users.get(String(shift.userId));
  return {
    userId: String(shift.userId),
    fullName: user ? user.fullName : null,
    emailAddress: user ? user.emailAddress : null,
    shiftId: String(shift._id),
    checkpointId: String(shift.checkpointId),
    checkpointName: checkpointNames.get(String(shift.checkpointId)) || null,
    shiftStartsAt: shift.startsAt.toISOString(),
    shiftEndsAt: shift.endsAt.toISOString(),
  };
}

module.exports = { loadShiftRows, loadUserDirectory, toShiftIdentity };
