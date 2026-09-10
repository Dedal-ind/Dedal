const FIRST_NAME_MAX_LENGTH = 6;
const PHONE_DIGITS_COUNT = 4;

/*
 * A human-readable participant identifier from the person's own identity:
 * first name (uppercase, capped at six characters) + surname initial (uppercase)
 * + the last four digits of the phone number. "Rahul Kumar" / "9876543210"
 * becomes RAHULK3210; a single-word name omits the surname initial.
 *
 * Returns null when the name or phone is missing or empty, so the caller can skip
 * generation rather than build a meaningless id.
 */
function generateParticipantId(fullName, phoneNumber) {
  if (typeof fullName !== "string" || fullName.trim().length === 0) {
    return null;
  }
  if (typeof phoneNumber !== "string" || phoneNumber.trim().length === 0) {
    return null;
  }

  const segments = fullName.trim().split(/\s+/);
  const firstName = segments[0].slice(0, FIRST_NAME_MAX_LENGTH).toUpperCase();
  const surnameInitial = segments.length > 1 ? segments[segments.length - 1][0].toUpperCase() : "";
  const lastDigits = phoneNumber.replace(/\D/g, "").slice(-PHONE_DIGITS_COUNT);

  return `${firstName}${surnameInitial}${lastDigits}`;
}

module.exports = { generateParticipantId };
