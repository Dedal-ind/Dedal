/*
 * ══════════════════════════════════════════════════════════════════════════
 * AUTO-SHIFT ACCESS WINDOWS — the client's "scanner access opens 3 hours
 * before the event" requirement, expressed as two dials.
 *
 * When a VOLUNTEER assignment is created, a default shift is auto-created per
 * covered event (or at the fest main gate for a fest-wide assignment):
 *   startsAt = event.startsAt - EARLY_ACCESS_WINDOW_HOURS  (3 hours)
 *   endsAt   = event.endsAt   + LATE_ACCESS_WINDOW_HOURS  (check-outs run on
 *                                                          after the event
 *                                                          nominally ends)
 * Every read goes through these constants — never hardcode 3 or 1 — so a fest
 * that needs different windows is a one-line change, not a hunt.
 * ══════════════════════════════════════════════════════════════════════════
 */
/*
 * THREE hours, the client's stated number — a volunteer is at the venue and
 * scanning well before doors. Changed from an earlier 4-hour default; the value
 * lives here alone so a fest needing a different lead time is a one-line change.
 */
const EARLY_ACCESS_WINDOW_HOURS = 3;
/*
 * ZERO: the client's rule for the simplified staff flow is "the shift ends when
 * the event ends". It was an hour's grace before; a fest that wants the grace
 * back changes this one number.
 */
const LATE_ACCESS_WINDOW_HOURS = 0;

/*
 * The volunteer-shift vocabulary. The model, the service, and the scanner
 * authorization all read the statuses from here rather than re-declaring them.
 */
const SHIFT_STATUSES = {
  SCHEDULED: "scheduled",
  CANCELLED: "cancelled",
};

const SHIFT_STATUS_VALUES = Object.values(SHIFT_STATUSES);

module.exports = {
  SHIFT_STATUSES,
  SHIFT_STATUS_VALUES,
  EARLY_ACCESS_WINDOW_HOURS,
  LATE_ACCESS_WINDOW_HOURS,
};
