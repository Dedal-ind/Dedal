// registration-status.js
// The two questions the participant screens ask about a registration's status,
// answered in one place because they are answered differently.
//
// "DO I HOLD A SEAT HERE" AND "MAY I BUY ADD-ONS" ARE NOT THE SAME QUESTION,
// and conflating them is how the add-on button came to be offered to people the
// backend would then refuse. They are both here, next to each other, so the
// difference is visible rather than something each screen has to remember.

/*
 * A seat that still exists. Wide on purpose:
 *
 *   - `pendingPayment` is a checkout someone paused, not a seat they gave up;
 *   - `waitlisted` is a place in a queue, which is still a claim on the event;
 *   - `attended` is a seat that was used, which is still a seat that was held.
 *
 * What it excludes is the point: `cancelled` and `paymentExpired`. Matching on
 * event or fest id ALONE counted those, so screens offered a pass and unlocked
 * actions for a registration the participant no longer had.
 */
export const LIVE_REGISTRATION_STATUSES = new Set([
  'confirmed',
  'attended',
  'waitlisted',
  'pendingPayment',
]);

export function isLiveRegistrationStatus(status) {
  return LIVE_REGISTRATION_STATUSES.has(status);
}

/*
 * Add-ons need a CONFIRMED seat and nothing less. add-on-service refuses
 * anything else with REGISTRATION_NOT_CONFIRMED, so this mirrors that rule
 * rather than offering a second opinion on it - a screen that gates on the live
 * set instead lets a pendingPayment row tap through to a 409 it cannot explain.
 */
export function canPurchaseAddOns(status) {
  return status === 'confirmed';
}
