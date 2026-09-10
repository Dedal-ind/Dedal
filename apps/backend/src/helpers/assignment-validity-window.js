const { STAFF_ROLES } = require("../constants/staff-constants");

const HOURS_BEFORE_FIRST_EVENT = 24;
const HOURS_AFTER_LAST_EVENT = 2;
/*
 * A coordinator runs the event, not just the door: they need the console while
 * they are still setting the event up. The client's number is two days, so a
 * coordinator's window opens 48 hours ahead and closes when the event does.
 */
const COORDINATOR_HOURS_BEFORE_FIRST_EVENT = 48;
const COORDINATOR_HOURS_AFTER_LAST_EVENT = 0;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/*
 * A staff member needs access before the doors open and a little after they
 * close, so the window is the events' own span widened at both ends. It is
 * derived, never typed in: an admin who edits an event's schedule must not have
 * to remember to edit every assignment that covers it.
 *
 * An assignment naming no event has nothing to derive from, and gets no window.
 *
 * `role` is optional and defaults to the historical (volunteer) window, so every
 * existing caller keeps the behaviour it had.
 */
function computeAssignmentValidityWindow(events, role = null) {
  if (events.length === 0) {
    return { validFrom: null, validTo: null };
  }

  const isCoordinator = role === STAFF_ROLES.COORDINATOR;
  const hoursBefore = isCoordinator
    ? COORDINATOR_HOURS_BEFORE_FIRST_EVENT
    : HOURS_BEFORE_FIRST_EVENT;
  const hoursAfter = isCoordinator ? COORDINATOR_HOURS_AFTER_LAST_EVENT : HOURS_AFTER_LAST_EVENT;

  const earliestStart = Math.min(...events.map((event) => event.startsAt.getTime()));
  const latestEnd = Math.max(...events.map((event) => event.endsAt.getTime()));

  return {
    validFrom: new Date(earliestStart - hoursBefore * MILLISECONDS_PER_HOUR),
    validTo: new Date(latestEnd + hoursAfter * MILLISECONDS_PER_HOUR),
  };
}

module.exports = {
  computeAssignmentValidityWindow,
  HOURS_BEFORE_FIRST_EVENT,
  HOURS_AFTER_LAST_EVENT,
  COORDINATOR_HOURS_BEFORE_FIRST_EVENT,
  COORDINATOR_HOURS_AFTER_LAST_EVENT,
};
