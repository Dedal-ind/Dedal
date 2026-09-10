/*
 * The full registration lifecycle. The MVP writes only confirmed, waitlisted and
 * cancelled; the remaining values are reserved for Day 10+ scoring and bracket
 * progression, and are enumerated here so the model's enum already accepts them.
 */
const REGISTRATION_STATUSES = {
  CONFIRMED: "confirmed",
  WAITLISTED: "waitlisted",
  CANCELLED: "cancelled",
  ATTENDED: "attended",
  NO_SHOW: "noShow",
  WINNER_1ST: "winner1st",
  WINNER_2ND: "winner2nd",
  WINNER_3RD: "winner3rd",
  ADVANCED_TO_R2: "advancedToR2",
  ADVANCED_TO_R3: "advancedToR3",
  ADVANCED_TO_QUARTER_FINAL: "advancedToQuarterFinal",
  ADVANCED_TO_SEMI_FINAL: "advancedToSemiFinal",
  ADVANCED_TO_FINAL: "advancedToFinal",
  ELIMINATED: "eliminated",
  DISQUALIFIED: "disqualified",
  // Paid events: the seat is held but the participant cannot enter until payment
  // confirms. Terminal PAYMENT_EXPIRED means the hold lapsed and the seat was freed.
  PENDING_PAYMENT: "pendingPayment",
  PAYMENT_EXPIRED: "paymentExpired",
  /*
   * The ORGANISER closed the event, so every held seat ends with it. Distinct
   * from CANCELLED (which the participant, a coordinator or an admin chose for
   * one row) so a roster can label them differently — "Cancelled — organiser"
   * against "Cancelled" — and so an audit trail never muddles a participant
   * walking away with an event that stopped existing.
   */
  EVENT_CANCELLED: "eventCancelled",
};

/* The lifecycle of a registration's payment. notRequired for free events. */
const PAYMENT_STATUSES = {
  NOT_REQUIRED: "notRequired",
  PENDING: "pending",
  COMPLETED: "completed",
  EXPIRED: "expired",
};

// How long a pending-payment hold survives before its seat may be reclaimed.
const PAYMENT_EXPIRY_MINUTES = 30;

/* A registration in one of these holds a seat and blocks a second active one. */
const ACTIVE_REGISTRATION_STATUSES = [
  REGISTRATION_STATUSES.CONFIRMED,
  REGISTRATION_STATUSES.WAITLISTED,
];

/*
 * How long before an event starts self-cancellation shuts. A coordinator needs a
 * settled roster to run the event from; an administrator and the event's own
 * coordinator are exempt and may cancel at any point.
 */
const CANCELLATION_FREEZE_MINUTES_BEFORE_EVENT = 120;

/*
 * The statuses a participant may cancel themselves out of. Identical to
 * ACTIVE_REGISTRATION_STATUSES today, and deliberately not an alias of it: that
 * list answers "does this row hold a seat", this one answers "may its owner walk
 * away". A future status could hold a seat without being self-cancellable.
 */
const CANCELLABLE_SELF_STATUSES = Object.freeze([
  REGISTRATION_STATUSES.CONFIRMED,
  REGISTRATION_STATUSES.WAITLISTED,
]);

const MINIMUM_CANCELLATION_REASON_LENGTH = 10;
const MAXIMUM_CANCELLATION_REASON_LENGTH = 500;

/* Who ended a registration. Written only when a row is cancelled. */
const CANCELLED_BY_ROLES = {
  SELF: "self",
  COORDINATOR: "coordinator",
  ADMIN: "admin",
};

const MEMBER_EMAILS_MAX = 20;
const TEAM_NAME_MIN_LENGTH = 2;
const TEAM_NAME_MAX_LENGTH = 60;
const INVITE_CODE_LENGTH = 8;

// Fest-level food preference, collected during registration only when the fest
// offers food. Null on a registration whose fest does not.
const FOOD_PREFERENCES = {
  VEG: "veg",
  NON_VEG: "nonVeg",
  NO_MEAL_NEEDED: "noMealNeeded",
};

module.exports = {
  FOOD_PREFERENCES,
  PAYMENT_STATUSES,
  PAYMENT_EXPIRY_MINUTES,
  REGISTRATION_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLATION_FREEZE_MINUTES_BEFORE_EVENT,
  CANCELLABLE_SELF_STATUSES,
  MINIMUM_CANCELLATION_REASON_LENGTH,
  MAXIMUM_CANCELLATION_REASON_LENGTH,
  CANCELLED_BY_ROLES,
  MEMBER_EMAILS_MAX,
  TEAM_NAME_MIN_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  INVITE_CODE_LENGTH,
};
