const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { SHIFT_STATUSES } = require("../constants/shift-constants");

const VOLUNTEER_AUTHORIZATION = {
  AUTHORIZED_VIA_SHIFT: "authorized_via_shift",
  AUTHORIZED_VIA_FALLBACK: "authorized_via_fallback",
  DENIED: "denied",
};

/*
 * The shift dimension of a volunteer's scanner authorization at one checkpoint.
 * - No shifts anywhere in the fest → "authorized_via_fallback": the shift system
 *   does not constrain this volunteer yet, so the caller applies the old
 *   staffAssignment window + coverage rules (non-breaking transition).
 * - A scheduled shift on THIS checkpoint covering now → "authorized_via_shift".
 * - Has shifts, but none active here now → "denied".
 * The existence check uses { limit: 1 } — we only need at-least-one vs zero.
 */
async function resolveVolunteerCheckpointAuthorization({ userId, festId, checkpointId, now }) {
  const scheduledShiftCount = await VolunteerShiftModel.countDocuments(
    { userId, festId, status: SHIFT_STATUSES.SCHEDULED },
    { limit: 1 }
  );
  if (scheduledShiftCount === 0) {
    return VOLUNTEER_AUTHORIZATION.AUTHORIZED_VIA_FALLBACK;
  }

  const activeShift = await VolunteerShiftModel.findOne({
    userId,
    festId,
    checkpointId,
    status: SHIFT_STATUSES.SCHEDULED,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  })
    .select("_id")
    .lean();

  return activeShift ? VOLUNTEER_AUTHORIZATION.AUTHORIZED_VIA_SHIFT : VOLUNTEER_AUTHORIZATION.DENIED;
}

module.exports = { resolveVolunteerCheckpointAuthorization, VOLUNTEER_AUTHORIZATION };
