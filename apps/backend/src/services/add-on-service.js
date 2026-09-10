const mongoose = require("mongoose");

const { AddOnOrderModel } = require("../models/add-on-order-model");
const { RegistrationModel } = require("../models/registration-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { OFFER_SCOPES, RESERVED_OFFER_KEYS } = require("../constants/fest-constants");

/*
 * "Reserved" is a property of the KEY, not a flag on the offer document — food
 * and accommodation are collected as their own registration fields and priced by
 * their own rule, so they are excluded from the generic add-on list.
 */
const RESERVED_OFFER_KEYS_LIST = Object.values(RESERVED_OFFER_KEYS);
const {
  generatePaymentGroupId,
  computeRegistrationFee,
} = require("../helpers/registration-payment-helpers");
const { resolveOfferSelections, listActiveOffers } = require("../helpers/offer-preference-helpers");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/*
 * Add-ons bought AFTER a registration already exists.
 *
 * The registration form collects offers at registration time; this is the same
 * offers, chosen later — by someone who joined a team with an invite code and
 * therefore never saw that form. It is an ADDITION to that flow, not a
 * replacement: nothing here touches how a first-time registration is priced or
 * confirmed.
 *
 * Two paths, and the split is not cosmetic. Free add-ons are applied inline,
 * because sending somebody to a payment screen for a zero-rupee order is a dead
 * end Razorpay will reject. Paid add-ons park their intent in an AddOnOrder and
 * are applied only when the money is captured — see add-on-order-model.js for
 * why the registration itself must not be pushed back into a pending state.
 */

async function loadOwnConfirmedRegistration(userId, registrationId) {
  const registration = mongoose.Types.ObjectId.isValid(registrationId)
    ? await RegistrationModel.findById(registrationId)
    : null;
  if (!registration || String(registration.userId) !== String(userId)) {
    // A registration belonging to somebody else is indistinguishable from one
    // that does not exist — the same rule the registration detail read uses.
    throw new ApplicationError(
      404,
      ERROR_CODES.REGISTRATION_NOT_FOUND,
      "Registration not found."
    );
  }
  if (registration.status !== REGISTRATION_STATUSES.CONFIRMED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.REGISTRATION_NOT_CONFIRMED,
      "Add-ons can only be added to a confirmed registration.",
      { currentStatus: registration.status }
    );
  }
  return registration;
}

async function loadFestAndEvent(registration) {
  const event = await EventModel.findById(registration.eventId);
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const fest = await FestModel.findById(event.festId);
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return { fest, event };
}

/*
 * What the participant can still buy: every active offer at both scopes, minus
 * the ones already on the registration. Reserved food/accommodation are excluded
 * — those are collected as their own fields at registration time and priced by a
 * different rule, so offering them here would create a second, disagreeing way
 * to buy the same thing.
 */
async function listAvailableAddOns(userId, registrationId) {
  const registration = await loadOwnConfirmedRegistration(userId, registrationId);
  const { fest, event } = await loadFestAndEvent(registration);

  const alreadyChosen = new Set(
    (registration.offerSelections ?? []).map(
      (selection) => `${selection.scope ?? OFFER_SCOPES.FEST}:${selection.offerKey}`
    )
  );

  const offers = listActiveOffers(fest, event)
    .filter((entry) => !RESERVED_OFFER_KEYS_LIST.includes(entry.offer.offerKey))
    .filter((entry) => !alreadyChosen.has(`${entry.scope}:${entry.offer.offerKey}`))
    .map((entry) => ({
      offerKey: entry.offer.offerKey,
      scope: entry.scope,
      offerName: entry.offer.offerName,
      description: entry.offer.description ?? null,
      isPaid: entry.offer.isPaid !== false,
      ratePaise: entry.offer.ratePaise ?? 0,
      collectsNumberOfPeople: entry.offer.collectsNumberOfPeople === true,
      collectsNumberOfDays: entry.offer.collectsNumberOfDays === true,
      numberOfPeopleMinimum: entry.offer.numberOfPeopleMinimum ?? 1,
      numberOfPeopleMaximum: entry.offer.numberOfPeopleMaximum ?? null,
      numberOfDaysMinimum: entry.offer.numberOfDaysMinimum ?? 1,
      numberOfDaysMaximum: entry.offer.numberOfDaysMaximum ?? null,
    }));

  return {
    registrationId: String(registration._id),
    eventName: event.eventName,
    festName: fest.festName,
    offers,
  };
}

/*
 * Prices ONLY the new selections. computeRegistrationFee is the one fee formula
 * in the system, so it is reused rather than re-implemented — but it is asked
 * for the delta, not the total: the event fee is passed as zero (already paid at
 * registration) and the reserved axes as empty, leaving just the offer lines.
 */
function priceSelections(fest, event, resolvedSelections) {
  const freeEvent = { ...event.toObject(), feeType: "free", feeAmountPaise: 0 };
  const { offersFeePaise, breakdown } = computeRegistrationFee(
    freeEvent,
    1,
    fest,
    resolvedSelections,
    0,
    false
  );
  // Drop the zero "Registration" line the formula always prepends — this
  // purchase is not a registration and showing it reads as a double charge.
  return {
    amountPaise: offersFeePaise,
    breakdown: breakdown.filter((line) => line.label !== "Registration"),
  };
}

/*
 * Merges the bought selections onto the registration and refreshes the pass.
 *
 * Entitlements are NOT written here. syncOfferEntitlements derives what is owed
 * from the registration's own selections, so the single correct move is to store
 * the selections and let the existing sync recompute — writing entitlements
 * directly would create a second author of the same fact, and the two would
 * disagree the first time anything else changed a registration.
 */
async function applySelectionsToRegistration(registration, resolvedSelections) {
  const existingKeys = new Set(
    (registration.offerSelections ?? []).map(
      (selection) => `${selection.scope ?? OFFER_SCOPES.FEST}:${selection.offerKey}`
    )
  );
  const additions = resolvedSelections.filter(
    (selection) => !existingKeys.has(`${selection.scope}:${selection.offerKey}`)
  );
  if (additions.length === 0) {
    return registration;
  }

  registration.offerSelections = [...(registration.offerSelections ?? []), ...additions];
  await registration.save();

  const event = await EventModel.findById(registration.eventId).select("festId").lean();
  if (event) {
    const { ensurePassAndEventEntitlement } = require("./pass-service");
    // The same call the registration path makes: it issues the pass if needed
    // and re-syncs every offer entitlement from the confirmed registrations.
    await ensurePassAndEventEntitlement(registration.userId, event.festId, registration.eventId);
  }
  return registration;
}

/*
 * The endpoint. Returns either { paid: false } — applied, go to success — or
 * { paid: true, paymentGroupId } for the existing checkout screen to drive.
 */
async function addRegistrationAddOns(userId, registrationId, rawSelections, context = {}) {
  const registration = await loadOwnConfirmedRegistration(userId, registrationId);
  const { fest, event } = await loadFestAndEvent(registration);

  const resolvedSelections = resolveOfferSelections(fest, rawSelections, event);
  if (resolvedSelections.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "No valid add-ons were selected.",
      { offerSelections: "none of the selected offers are available for this registration" }
    );
  }

  const { amountPaise, breakdown } = priceSelections(fest, event, resolvedSelections);

  // Free add-ons never touch Razorpay: a zero-amount order is refused by the
  // gateway, so the only correct handling is to apply them inline.
  if (amountPaise === 0) {
    await applySelectionsToRegistration(registration, resolvedSelections);
    await recordAuditLog({
      actorUserId: userId,
      festId: fest._id,
      action: AUDIT_ACTIONS.REGISTRATION_ADD_ONS_ADDED,
      entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
      entityId: registration._id,
      afterState: { amountPaise: 0, offerKeys: resolvedSelections.map((row) => row.offerKey) },
      ...context,
    });
    return { paid: false, registrationId: String(registration._id), amountPaise: 0, breakdown };
  }

  const paymentGroupId = generatePaymentGroupId();
  await AddOnOrderModel.create({
    registrationId: registration._id,
    userId,
    festId: fest._id,
    eventId: event._id,
    paymentGroupId,
    offerSelections: resolvedSelections,
    amountPaise,
    status: "pending",
  });

  return {
    paid: true,
    paymentGroupId,
    registrationId: String(registration._id),
    amountPaise,
    breakdown,
  };
}

/*
 * Called by the payment dispatch when an add-on order's money is captured.
 * Idempotent: a replayed webhook finds the order already completed and returns
 * without merging the selections a second time.
 */
async function confirmAddOnOrder(paymentGroupId, paymentReference = null) {
  const order = await AddOnOrderModel.findOne({ paymentGroupId });
  if (!order) {
    throw new ApplicationError(
      404,
      ERROR_CODES.PAYMENT_GROUP_NOT_FOUND,
      "No pending add-on purchase was found for that group."
    );
  }
  if (order.status === "completed") {
    return { alreadyConfirmed: true, registrationId: String(order.registrationId) };
  }

  const registration = await RegistrationModel.findById(order.registrationId);
  if (!registration) {
    throw new ApplicationError(404, ERROR_CODES.REGISTRATION_NOT_FOUND, "Registration not found.");
  }

  await applySelectionsToRegistration(registration, order.offerSelections);

  order.status = "completed";
  order.completedAt = new Date();
  await order.save();

  await recordAuditLog({
    actorUserId: order.userId,
    festId: order.festId,
    action: AUDIT_ACTIONS.REGISTRATION_ADD_ONS_ADDED,
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: order.registrationId,
    afterState: {
      amountPaise: order.amountPaise,
      paymentReference: paymentReference || null,
      offerKeys: order.offerSelections.map((row) => row.offerKey),
    },
  });

  return { alreadyConfirmed: false, registrationId: String(order.registrationId) };
}

module.exports = {
  listAvailableAddOns,
  addRegistrationAddOns,
  confirmAddOnOrder,
};
