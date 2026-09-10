/*
 * Volunteer shift reminders — two emails per shift, 12 hours out and 1 hour out.
 *
 * A 6 AM gate shift nobody remembers is an unstaffed gate, and the app has no
 * push channel, so email is the only thing that reaches a volunteer who is not
 * already looking at the screen.
 *
 * NO CRON, NO JOB QUEUE. A sweep runs on a plain setInterval from application.js
 * and asks "which shifts are now inside a reminder window and have not been
 * told yet". That means:
 *   - no new infrastructure, no scheduler to keep alive, nothing to deploy;
 *   - a server restart loses nothing — state lives in the two stamps on the
 *     shift row, not in a timer;
 *   - a shift created 30 minutes before it starts still gets its 1-hour
 *     reminder on the next sweep (the window is "past due", not "exactly at"),
 *     which a precomputed timer would have missed entirely.
 *
 * The cost is granularity: a reminder can be up to one sweep interval late. For
 * a 12-hour and a 1-hour warning that is irrelevant.
 */

const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { SHIFT_STATUSES } = require("../constants/shift-constants");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/* How often application.js runs the sweep. */
const REMINDER_SWEEP_INTERVAL_MILLISECONDS = 5 * 60 * 1000;

/*
 * The two reminders, as data rather than duplicated code. `stampField` is both
 * the idempotency lock and the audit trail.
 */
const REMINDER_WINDOWS = [
  { hoursBeforeStart: 12, stampField: "reminderSentAt12h" },
  { hoursBeforeStart: 1, stampField: "reminderSentAt1h" },
];

/*
 * A shift is due for a reminder when its start is inside the window AND still in
 * the future. The upper bound matters: without it, every shift that has already
 * begun would look "past due" for its 12-hour reminder forever, and a volunteer
 * finishing a shift would be emailed that it starts in 12 hours.
 */
function buildDueFilter({ hoursBeforeStart, stampField }, now) {
  return {
    status: SHIFT_STATUSES.SCHEDULED,
    [stampField]: null,
    startsAt: {
      $gt: now,
      $lte: new Date(now.getTime() + hoursBeforeStart * MILLISECONDS_PER_HOUR),
    },
  };
}

/*
 * Claim-then-send, the same shape as sendPassEmailOnce. The stamp is written
 * BEFORE the send and rolled back if the send fails, so a crash mid-send costs
 * at most one duplicate rather than an unbounded retry loop — and two sweeps
 * racing cannot both claim the same row, because findOneAndUpdate on a null
 * field is atomic.
 */
async function claimShiftForReminder(shiftId, stampField) {
  return VolunteerShiftModel.findOneAndUpdate(
    { _id: shiftId, [stampField]: null, status: SHIFT_STATUSES.SCHEDULED },
    { $set: { [stampField]: new Date() } },
    { new: true }
  )
    .populate("userId", "fullName emailAddress")
    .populate("checkpointId", "checkpointName eventId")
    .populate("festId", "festName bannerImageUrl")
    .lean();
}

async function releaseReminderClaim(shiftId, stampField) {
  await VolunteerShiftModel.updateOne({ _id: shiftId }, { $set: { [stampField]: null } });
}

async function sendOneReminder(shift, window) {
  const claimed = await claimShiftForReminder(shift._id, window.stampField);
  if (!claimed) {
    return false; // cancelled, or another sweep got there first
  }

  try {
    if (!claimed.userId?.emailAddress) {
      // Nothing to send to. Leave the stamp in place so the sweep does not
      // retry this row every five minutes for the life of the process.
      return false;
    }

    /*
     * Required at call time, not at module load — the same late-require the
     * pass email uses, so a test suite's email mock (installed after this
     * module is first pulled in) is the one that actually receives the send.
     */
    const { sendShiftReminderEmail } = require("./email-service");

    // A checkpoint may be fest-wide (a main gate) rather than event-scoped, in
    // which case there is no event name to include.
    let eventName = null;
    if (claimed.checkpointId?.eventId) {
      const { EventModel } = require("../models/event-model");
      const event = await EventModel.findById(claimed.checkpointId.eventId)
        .select("eventName")
        .lean();
      eventName = event?.eventName ?? null;
    }

    const wasSent = await sendShiftReminderEmail({
      emailAddress: claimed.userId.emailAddress,
      fullName: claimed.userId.fullName,
      festName: claimed.festId?.festName ?? "your fest",
      festBannerImageUrl: claimed.festId?.bannerImageUrl ?? null,
      checkpointName: claimed.checkpointId?.checkpointName ?? "your checkpoint",
      eventName,
      shiftStartsAt: claimed.startsAt,
      shiftEndsAt: claimed.endsAt,
      hoursUntilStart: window.hoursBeforeStart,
    });
    if (!wasSent) {
      throw new Error("email transport reported failure");
    }
    return true;
  } catch (error) {
    await releaseReminderClaim(shift._id, window.stampField);
    console.error(`Shift reminder failed for shift ${shift._id}: ${error.message}`);
    return false;
  }
}

/*
 * One pass over both windows. Returns a count so a caller (or a test) can assert
 * on what actually went out. Never throws: a sweep that blows up must not take
 * the interval — or the process — with it.
 */
async function sendPendingShiftReminders(now = new Date()) {
  let sentCount = 0;
  for (const window of REMINDER_WINDOWS) {
    try {
      const dueShifts = await VolunteerShiftModel.find(buildDueFilter(window, now))
        .select("_id")
        .lean();
      for (const shift of dueShifts) {
        const wasSent = await sendOneReminder(shift, window);
        if (wasSent) {
          sentCount += 1;
        }
      }
    } catch (error) {
      console.error(`Shift reminder sweep failed (${window.stampField}): ${error.message}`);
    }
  }
  return sentCount;
}

/*
 * Started once from application.js. unref() so the timer never holds the process
 * open — without it a test runner or a graceful shutdown hangs for five minutes
 * waiting on a sweep nobody is going to read.
 */
function startShiftReminderSweep(intervalMilliseconds = REMINDER_SWEEP_INTERVAL_MILLISECONDS) {
  const timer = setInterval(() => {
    sendPendingShiftReminders().catch((error) =>
      console.error(`Shift reminder sweep threw: ${error.message}`)
    );
  }, intervalMilliseconds);
  timer.unref?.();
  return timer;
}

module.exports = {
  sendPendingShiftReminders,
  startShiftReminderSweep,
  REMINDER_SWEEP_INTERVAL_MILLISECONDS,
  REMINDER_WINDOWS,
};
