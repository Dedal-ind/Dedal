const { ADULT_AGE_YEARS } = require("../constants/consent-constants");

/*
 * Age is DERIVED, never stored.
 *
 * The user carries only a date of birth. A stored age, or a stored "is a
 * minor" flag, is wrong the morning after a birthday and nothing recomputes
 * it — so both are computed here, at read time, from the one fact that does
 * not change.
 *
 * WHY THE PREDICATE MATTERS. India's Digital Personal Data Protection Act,
 * 2023 treats anyone under eighteen as a child and flatly prohibits tracking,
 * behavioural monitoring, profiling and targeted advertising aimed at them.
 * There is no consent workaround. isUnderEighteen() is the switch that
 * personalised promotion selection must key off in a later phase. Nothing
 * consumes it yet.
 *
 * UNKNOWN IS NOT FALSE. A missing or unusable date of birth returns null, and
 * a caller must treat null as "may be a child": an unknown age served as an
 * adult is precisely the failure the penalty attaches to.
 *
 * OUTSTANDING OBLIGATION — VERIFIABLE PARENTAL CONSENT. The Act requires
 * verifiable consent from a parent or lawful guardian before processing a
 * child's personal data. No such flow exists yet. Until it does, a user for
 * whom this predicate is true OR null must receive only non-personalised,
 * non-tracked promotions, and nothing about them may feed profiling.
 */

function toUtcDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

/*
 * Whole years elapsed between dateOfBirth and `at` (default: now), by calendar
 * date in UTC. Returns null when the date of birth is absent or unparseable.
 */
function deriveAgeInYears(dateOfBirth, at = new Date()) {
  if (dateOfBirth === null || dateOfBirth === undefined || dateOfBirth === "") {
    return null;
  }
  const birth = toUtcDateParts(dateOfBirth);
  const reference = toUtcDateParts(at);
  if (!birth || !reference) {
    return null;
  }
  let age = reference.year - birth.year;
  const birthdayNotYetReached =
    reference.month < birth.month || (reference.month === birth.month && reference.day < birth.day);
  if (birthdayNotYetReached) {
    age -= 1;
  }
  return age;
}

/* true: a child under the Act. false: an adult. null: UNKNOWN — treat as a child. */
function isUnderEighteen(dateOfBirth, at = new Date()) {
  const age = deriveAgeInYears(dateOfBirth, at);
  if (age === null) {
    return null;
  }
  return age < ADULT_AGE_YEARS;
}

module.exports = { deriveAgeInYears, isUnderEighteen };
