/*
 * The CALENDAR DAY a scan belongs to, as a 'YYYY-MM-DD' string.
 *
 * WHY A STRING AND NOT A DATE. Daily campus access resets at local midnight, and
 * "local" is the fest's wall clock, not the server's and not UTC. Storing a Date
 * and comparing ranges would make every reader re-derive the day boundary, and
 * the first one to forget the offset would silently roll the day over at 05:30
 * local — which for an Indian fest means everyone who entered before half past
 * five in the morning is counted on the wrong day, and the whole first hour of a
 * fest day reads as the previous one.
 *
 * Storing the day key instead moves the timezone decision to exactly one place:
 * here. Two records are the same day when their strings are equal, which is also
 * what makes the unique index on (passId, festId, checkInDate) mean "one check-in
 * per person per day" without any range arithmetic.
 *
 * THIS IS ALSO WHY THERE IS NO MIDNIGHT CRON. Nothing has to be reset at
 * midnight: tomorrow simply produces a different key, so yesterday's record stops
 * matching on its own. A scheduled job that cleared yesterday's check-ins would be
 * a moving part that can fail, be missed, or run twice — this cannot.
 */

/*
 * India Standard Time (UTC+05:30). Hard-coded rather than read from the fest
 * because Fest carries no timezone field today and inventing a default of
 * "whatever the server is set to" is how a deployment move silently changes when
 * days roll over. When fests outside IST are supported, this becomes
 * fest.timeZone with this value as the fallback, and every caller below already
 * takes the fest so the signature does not have to change.
 */
const FEST_TIME_ZONE = "Asia/Kolkata";

/*
 * 'en-CA' is the deliberate choice: it is the locale whose short date format IS
 * ISO ('2026-08-24'). Formatting with 'en-GB' or 'en-US' and reassembling the
 * parts by hand is the same operation with more places to get the order wrong.
 */
function resolveFestDayKey(instant = new Date(), timeZone = FEST_TIME_ZONE) {
  return instant.toLocaleDateString("en-CA", { timeZone });
}

/* The day key for "now", in the fest's timezone. The common case, named. */
function resolveTodayFestDayKey(timeZone = FEST_TIME_ZONE) {
  return resolveFestDayKey(new Date(), timeZone);
}

/*
 * Whether a caller-supplied ?date= is a well-formed day key. Range-checked by
 * Date parsing rather than by regex alone, so '2026-13-45' is refused rather
 * than accepted as a string that simply matches nothing forever — an endpoint
 * that answers "0 check-ins" for an impossible date is worse than one that says
 * the date is wrong.
 */
function isValidFestDayKey(candidate) {
  if (typeof candidate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return false;
  }
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate;
}

module.exports = {
  FEST_TIME_ZONE,
  resolveFestDayKey,
  resolveTodayFestDayKey,
  isValidFestDayKey,
};
