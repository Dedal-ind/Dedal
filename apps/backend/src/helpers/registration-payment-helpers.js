const crypto = require("node:crypto");

const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { FEE_TYPES } = require("../constants/event-constants");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_EXPIRY_MINUTES,
} = require("../constants/registration-constants");
const { releaseTeamSeats } = require("./registration-seat-helpers");
const { RESERVED_OFFER_KEYS, OFFER_SCOPES } = require("../constants/fest-constants");
const { computeOfferTotalPaise } = require("./offer-schema-helpers");
const { listActiveOffers } = require("./offer-preference-helpers");

const MILLISECONDS_PER_MINUTE = 60 * 1000;

function isPaidEvent(event) {
  return event.feeType !== FEE_TYPES.FREE;
}

/* A shared id tying one payment group's rows together, 16 bytes hex like uploads. */
function generatePaymentGroupId() {
  return crypto.randomBytes(16).toString("hex");
}

/*
 * What the whole group owes for the EVENT alone: perPerson scales with the
 * roster, perTeam is flat, free is nothing. teamSize is 1 for a solo registration.
 */
function computeTotalFeePaise(event, teamSize) {
  if (!isPaidEvent(event)) {
    return 0;
  }
  if (event.feeType === FEE_TYPES.PER_TEAM) {
    return event.feeAmountPaise;
  }
  return event.feeAmountPaise * teamSize;
}

/*
 * The FULL registration fee: the event fee plus every selected offer priced
 * through the ONE formula (rate x people x days — see
 * helpers/offer-schema-helpers.js, which owns it). All arithmetic is INTEGER
 * PAISE — never convert to rupees before summing (a Rs 0.01 rounding bug per row
 * on a 500-participant fest is a real refund event). The frontend mirrors this
 * in helpers/fee-math.js; this function is the source of truth.
 *
 * Offers come from BOTH scopes (fest-wide and event-only). Quantities per offer:
 *   . reserved food          -> foodOrderCount people (0 when unset/noMealNeeded)
 *   . reserved accommodation -> 1 person when needsAccommodation, else nothing
 *   . every other offer      -> the resolved selection's people/days
 * A free offer (isPaid false) contributes zero however large the quantities.
 */
function computeRegistrationFee(
  event,
  teamSize,
  fest,
  resolvedOfferSelections,
  foodOrderCount,
  needsAccommodation
) {
  const eventFeePaise = computeTotalFeePaise(event, teamSize);
  // Quantity 1 for the registration line keeps every field an integer even for
  // perTeam fees that do not divide evenly across the roster.
  const breakdown = [
    { label: "Registration", quantity: 1, unitPaise: eventFeePaise, subtotalPaise: eventFeePaise },
  ];

  const offersByScopedKey = new Map(
    listActiveOffers(fest, event).map((entry) => [`${entry.scope}:${entry.offer.offerKey}`, entry.offer])
  );
  function findReservedOffer(offerKey) {
    return (
      offersByScopedKey.get(`${OFFER_SCOPES.FEST}:${offerKey}`) ??
      offersByScopedKey.get(`${OFFER_SCOPES.EVENT}:${offerKey}`) ??
      null
    );
  }

  let offersFeePaise = 0;
  function addOfferLine(offer, numberOfPeople, numberOfDays) {
    if (!offer || numberOfPeople <= 0) {
      return;
    }
    const subtotalPaise = computeOfferTotalPaise(offer, numberOfPeople, numberOfDays);
    if (subtotalPaise <= 0) {
      return;
    }
    offersFeePaise += subtotalPaise;
    // The breakdown line's quantity is the multiplied-out unit count, so the
    // stored snapshot still reconciles line-by-line without knowing the axes.
    const quantity = (offer.collectsNumberOfPeople ? numberOfPeople : 1) * (offer.collectsNumberOfDays ? numberOfDays : 1);
    breakdown.push({
      label: offer.offerName,
      quantity,
      unitPaise: offer.ratePaise ?? 0,
      subtotalPaise,
    });
  }

  addOfferLine(findReservedOffer(RESERVED_OFFER_KEYS.FOOD), foodOrderCount ?? 0, 1);
  addOfferLine(findReservedOffer(RESERVED_OFFER_KEYS.ACCOMMODATION), needsAccommodation ? 1 : 0, 1);
  for (const selection of resolvedOfferSelections ?? []) {
    const scopedKey = `${selection.scope ?? OFFER_SCOPES.FEST}:${selection.offerKey}`;
    addOfferLine(
      offersByScopedKey.get(scopedKey),
      selection.numberOfPeople ?? 1,
      selection.numberOfDays ?? 1
    );
  }

  return {
    eventFeePaise,
    offersFeePaise,
    totalFeePaise: eventFeePaise + offersFeePaise,
    breakdown,
  };
}

/* A pending-payment hold that has outlived its window. */
function isPendingPaymentExpired(registration, now = new Date()) {
  if (registration.status !== REGISTRATION_STATUSES.PENDING_PAYMENT) {
    return false;
  }
  const expiresAt = registration.createdAt.getTime() + PAYMENT_EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE;
  return now.getTime() >= expiresAt;
}

/*
 * Lazy expiry: called before a new claim on this event, so a hold that lapsed
 * frees its seat without a cron job. Each expired row held one seat, so the count
 * released is the number of rows flipped. No-op when nothing has expired.
 */
async function releaseExpiredPendingPaymentSeats(event) {
  const cutoff = new Date(Date.now() - PAYMENT_EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE);
  const expired = await RegistrationModel.find({
    eventId: event._id,
    status: REGISTRATION_STATUSES.PENDING_PAYMENT,
    createdAt: { $lt: cutoff },
  }).select("_id");
  if (expired.length === 0) {
    return;
  }
  await RegistrationModel.updateMany(
    { _id: { $in: expired.map((registration) => registration._id) } },
    { $set: { status: REGISTRATION_STATUSES.PAYMENT_EXPIRED, paymentStatus: PAYMENT_STATUSES.EXPIRED } }
  );
  await releaseTeamSeats(event, expired.length);

  /*
   * The seats just came back, so the queue moves. Required lazily to avoid a
   * cycle (the promotion service reaches back into pass-service, which reaches
   * here). Never throws — see promoteFromWaitlist.
   */
  const { promoteFromWaitlist } = require("../services/registration/waitlist-promotion-service");
  await promoteFromWaitlist(event._id, expired.length);
}

/* Loads the event (with festId) for a registration whose payment just confirmed. */
function loadEventForRegistration(eventId) {
  return EventModel.findById(eventId);
}

module.exports = {
  isPaidEvent,
  generatePaymentGroupId,
  computeTotalFeePaise,
  computeRegistrationFee,
  isPendingPaymentExpired,
  releaseExpiredPendingPaymentSeats,
  loadEventForRegistration,
};
